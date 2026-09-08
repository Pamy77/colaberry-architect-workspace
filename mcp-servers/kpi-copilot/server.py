"""kpi-copilot — MCP server for the Small Business KPI Copilot.

One tool so far:
  - verify_kpi_movement — recompute a KPI's month-over-month change from the
    stored readings and decide whether the swing is large enough to alert on
    (the REQ-013 check that must pass before any alert goes out).

Data source: kpi_readings.sample.json alongside this file. SAMPLE data — there is
no persisted real KPI data in the project yet (STORY-002 not built).
"""

import atexit
import collections
import hashlib
import json
import logging
import os
import sys
import time
import uuid
import warnings
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

import httpx2

from mcp import types
from mcp.server import MCPServer
from mcp.server.mcpserver import Context
from mcp.server.mcpserver.exceptions import ResourceError
from mcp.shared.exceptions import MCPDeprecationWarning
from pydantic import Field

from kpi_analysis import (
    build_digest_text,
    prior_month,
    render_rule_based_brief,
    summarize_period,
)

_SERVICE = "kpi-copilot"

mcp = MCPServer(_SERVICE)

_PACKAGE_DIR = Path(__file__).resolve().parent
_DATA_FILE = _PACKAGE_DIR / "kpi_readings.sample.json"

# The only directory tree this server will open a readings file from, no matter
# how broad the roots the connecting client declares. The `source` override and
# the bundled sample alike must resolve inside here. If a real external data
# location is ever added, append it here EXPLICITLY — never widen the check to
# "anywhere a declared root reaches".
_ALLOWED_DATA_ROOTS: tuple[Path, ...] = (_PACKAGE_DIR,)


# --- Live KPI Copilot backend: one pooled HTTP client --------------------------
#
# `check_live_kpi_dashboard` (defined far below) is the only tool that talks to a
# real running system: the project's own Express backend from STORY-003, over
# HTTP. Its config comes from the environment ONLY — never a literal in this file,
# never a value written to a log line or returned in an error:
#
#   KPI_COPILOT_API_BASE_URL  (required)  e.g. http://127.0.0.1:3001
#   KPI_COPILOT_API_TOKEN     (optional)  sent as `Authorization: Bearer <token>`
#
# The request PATH is the fixed constant `_KPIS_PATH`. Nothing the model supplies
# is ever concatenated into it (see the tool for how the `kpi` keyword is passed).

_API_BASE_URL_ENV = "KPI_COPILOT_API_BASE_URL"
_API_TOKEN_ENV = "KPI_COPILOT_API_TOKEN"
_KPIS_PATH = "/api/kpis"  # fixed — never built from caller/model input

# Explicit, bounded timeout on every phase of the outbound call (requirement 2).
_HTTP_TIMEOUT = httpx2.Timeout(connect=3.0, read=8.0, write=3.0, pool=3.0)
# A small, deliberate connection pool. The client below is process-wide and
# reused by every tool call; only the per-call Response is closed each time.
_HTTP_LIMITS = httpx2.Limits(max_connections=4, max_keepalive_connections=2)

_HTTP_CLIENT: "httpx2.Client | None" = None


def _get_http_client() -> "httpx2.Client":
    """The one process-wide HTTP client. It owns the keep-alive connection pool;
    every `check_live_kpi_dashboard` call reuses it (requirement 5). Individual
    `Response` objects are released per call in a `finally`; this client is not."""
    global _HTTP_CLIENT
    if _HTTP_CLIENT is None:
        _HTTP_CLIENT = httpx2.Client(timeout=_HTTP_TIMEOUT, limits=_HTTP_LIMITS)
    return _HTTP_CLIENT


@atexit.register
def _close_http_client() -> None:
    """Close the pool on interpreter shutdown. Not part of any request path."""
    global _HTTP_CLIENT
    if _HTTP_CLIENT is not None:
        _HTTP_CLIENT.close()
        _HTTP_CLIENT = None


# --- Slack alert delivery: the real outbound leg of REQ-005 --------------------
#
# .colaberry/plan.json lists Slack among the systems this project integrates with
# (REQ-006), and REQ-005 requires alerts to reach owners "via email and Slack".
# STORY-004 built the alert *pipeline* (detection + dedupe + dry-run transports);
# this tool is the real Slack leg. Config is environment-only, same rule as the
# backend client above — never a literal here, never logged, never in an error:
#
#   KPI_COPILOT_SLACK_WEBHOOK_URL  (required)  a Slack Incoming Webhook URL
#
# A webhook URL is a credential — anyone holding it can post to the channel — so
# it is read from os.environ at call time and never echoed back.

_SLACK_WEBHOOK_ENV = "KPI_COPILOT_SLACK_WEBHOOK_URL"
_SLACK_HOST = "hooks.slack.com"
# Explicit, bounded timeout on every phase — a slow Slack cannot hang the server.
_SLACK_TIMEOUT = httpx2.Timeout(connect=3.0, read=5.0, write=3.0, pool=3.0)
_SLACK_TEXT_MAX = 4000  # sane cap on the assembled message body

_SEVERITY_PREFIX = {
    "info": ":information_source: *KPI update*",
    "warning": ":warning: *KPI alert*",
    "critical": ":rotating_light: *KPI alert - critical*",
}

# Bounded in-process guard against posting the SAME alert twice. Maps a dedup key
# -> unix timestamp of the last successful post. Per-process only; a restart
# forgets it (documented in the README under "What this server assumes").
#
# The key identifies the EVENT, not the wording:
#   * caller passes `dedup_key`  -> keyed on that ("k:" prefix). The same event is
#     never re-posted for the life of the process, however far apart the calls.
#   * caller passes nothing      -> keyed on (severity, summary, details) ("w:"
#     prefix) BUT only treated as a duplicate within `_SLACK_DEDUP_WINDOW_S`. A
#     genuine later recurrence that happens to read identically is re-sent, not
#     silently swallowed. This is the bug this design fixes: wording != event.
_SLACK_SENT: "collections.OrderedDict[str, float]" = collections.OrderedDict()
_SLACK_SENT_MAX = 256
_SLACK_DEDUP_WINDOW_S = 600  # 10 min: long enough to catch a retry, short enough
#                              that a real re-alert hours/days later still goes out


def _slack_dedup_key(
    dedup_key: str | None, summary: str, details: list[str], severity: str
) -> str:
    if dedup_key:
        return "k:" + hashlib.sha256(dedup_key.encode("utf-8")).hexdigest()
    raw = json.dumps([severity, summary, details], separators=(",", ":"))
    return "w:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _slack_text(summary: str, details: list[str], severity: str) -> str:
    return "\n".join([_SEVERITY_PREFIX[severity], summary, *(f"• {d}" for d in details)])


# --- Structured log notifications ------------------------------------------------
# This SDK marks MCP protocol logging deprecated for the 2026-07-28 handshake
# (SEP-2577), but the version this server negotiates (2025-11-25) still delivers
# notifications/message on every level. We use that path on purpose, so quiet the
# per-call MCPDeprecationWarning it would otherwise spam to stderr.
warnings.filterwarnings("ignore", category=MCPDeprecationWarning)


async def _accept_log_level(_ctx: object, _params: types.SetLevelRequestParams) -> types.EmptyResult:
    """Handler for `logging/setLevel`. Registering it is what makes the low-level
    server advertise the `logging` capability (capabilities are derived from which
    handlers exist). No level is stored: on the 2025-11-25 handshake every level is
    deliverable and the client filters its own view.

    WHY the capability must be declared: without it the client drops every log
    message on the floor. Nothing errors. The code looks broken and is not.
    """
    return types.EmptyResult()


# MCPServer exposes no constructor switch for this, so register on the low-level
# server directly — handler present => capability advertised at initialize time.
mcp._lowlevel_server.add_request_handler("logging/setLevel", types.SetLevelRequestParams, _accept_log_level)


class _InvocationLogger:
    """One structured logger per tool call.

    Mints a single correlation id and stamps it — with the service and tool
    names — onto every line, so one invocation can be followed across every
    boundary it crosses. `data` is always an object with a stable `event` name,
    never a formatted sentence, and carries identifiers, counts and durations
    only — never a key, connection string, credential or raw record.
    """

    def __init__(self, ctx: Context, tool: str) -> None:
        self._ctx = ctx
        self.correlation_id = str(uuid.uuid4())
        self._base = {"service": _SERVICE, "tool": tool, "correlation_id": self.correlation_id}
        self._t0 = time.perf_counter()

    def elapsed_ms(self) -> float:
        return round((time.perf_counter() - self._t0) * 1000, 2)

    async def event(self, level: str, event: str, /, **fields: object) -> None:
        await self._ctx.log(level, {"event": event, **self._base, **fields}, logger_name=_SERVICE)


class _ProgressReporter:
    """One progress channel per tool invocation — the single place any tool that
    can run longer than a couple of seconds emits `notifications/progress`.

    What it centralises:

    * **Token gating.** The caller's `progressToken` (if any) rides on the inbound
      request's `_meta`. This class reads it once. If the caller sent none, every
      method is a no-op: nothing is emitted and the tool behaves exactly as it did
      before progress existed.
    * **Real totals only.** `step()` reports a running COUNT. Construct with
      `total=<n>` when there is a genuine, known number of units of work (e.g. one
      per tracked KPI) and the count is reported against it. Construct with no
      `total` when the amount of work is genuinely not knowable up front: the count
      still advances, but no fraction is invented and each message says as much.
    """

    def __init__(self, ctx: Context, *, total: float | None = None) -> None:
        self._ctx = ctx
        meta = ctx.request_context.meta
        self._token = meta.get("progress_token") if meta else None
        self._total = total
        self._count = 0.0

    @property
    def active(self) -> bool:
        """True only when the caller sent a progressToken."""
        return self._token is not None

    async def step(self, message: str, *, advance: float = 1.0) -> None:
        """Advance the running count by `advance` and emit one progress
        notification. A no-op when the caller sent no progressToken."""
        self._count += advance
        if self._token is None:
            return
        if self._total is not None:
            await self._ctx.report_progress(self._count, self._total, message)
        else:
            await self._ctx.report_progress(self._count, None, f"{message} — total not known up front")


def _load_readings(path: Path = _DATA_FILE) -> list[dict]:
    """Read KPI readings from `path` (default: the bundled sample, kept editable
    without restarting the server).

    INTERNAL — the only caller is `_load_readings_logged`, itself reached only via
    `_open_gated_readings`. `path` must already have passed the roots gate; do not
    call this (or pass a raw caller-supplied path to it) from anywhere else.
    """
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)["readings"]


async def _load_readings_logged(log: _InvocationLogger, path: Path = _DATA_FILE) -> list[dict]:
    """Read the readings file as a timed external boundary: one line when the read
    starts, one when it finishes with its duration in ms and the row count.

    INTERNAL — call `_open_gated_readings` instead, which runs the roots check and
    then delegates here with an already-validated path."""
    await log.event("info", "data_load_started", source=path.name)
    start = time.perf_counter()
    rows = _load_readings(path)
    await log.event(
        "info",
        "data_load_completed",
        source=path.name,
        row_count=len(rows),
        duration_ms=round((time.perf_counter() - start) * 1000, 2),
    )
    return rows


# --- Filesystem roots enforcement ---------------------------------------------
#
# ONE containment helper guards EVERY filesystem read in this server:
# `_resolve_within_client_roots` canonicalises the requested path and confirms it
# sits inside a root the client declared. `_open_gated_readings` is the single
# choke point every tool AND resource calls to turn a path into an open file —
# nothing in this module calls `open()` / `_load_readings()` on a path that has
# not passed through it, including the bundled sample file (see `_open_gated_readings`).
#
# A plain `raw_path.startswith(root)` string check is deliberately NOT used
# anywhere here. It is unsafe three ways, and each is a real bypass:
#   * `<root>/../../etc/passwd` has `<root>` as a text prefix but resolves outside it.
#   * `<root>/link` where `link` is a symlink to `/etc/shadow` has the prefix too,
#     yet the bytes read come from outside the root.
#   * `<root>` as a text prefix also matches the sibling directory `<root>-secret/`.
# The helper defeats all three by resolving FIRST (collapsing `..`, following
# symlinks) and then comparing whole path components with `Path.is_relative_to`.

# Why a caller-supplied path was refused. `no_capability` / `empty_list` are the
# "client declared no roots at all" cases: on those we deny by default rather than
# fall back to unrestricted access (see `_open_gated_readings`).
RootsDeniedCategory = str  # no_capability | empty_list | list_failed | outside_server_dir | outside_roots | bad_path


class RootsDenied(Exception):
    """A requested file path could not be confirmed inside any root the client declared."""

    def __init__(self, requested: str, resolved: str, reason: str, category: RootsDeniedCategory) -> None:
        super().__init__(reason)
        self.requested = requested
        self.resolved = resolved
        self.reason = reason
        self.category = category

    @property
    def deny_by_default(self) -> bool:
        """True when the denial is because the client offered no roots to check
        against — the requirement-4 "deny rather than allow everything" path."""
        return self.category in ("no_capability", "empty_list")


def _root_uri_to_path(uri: object) -> Path:
    """`file:///C:/data%20dir` (a roots URI, percent-encoded) -> a real local Path.
    Handles the `file://host/share` UNC form via the netloc."""
    parts = urlparse(str(uri))
    local = url2pathname(unquote(parts.path))
    if parts.netloc:  # file://server/share/... (UNC); uncommon, kept for completeness
        local = rf"\\{parts.netloc}{local}"
    return Path(local)


async def _resolve_within_client_roots(ctx: Context, requested: str, log: "_InvocationLogger") -> Path:
    """Ask the client for its declared roots, resolve `requested` to its REAL
    filesystem path, and return that path only if it sits inside one of the
    declared roots. Every other case raises :class:`RootsDenied`.

    THE ORDER IS THE WHOLE CONTROL (see the module comment above for why a raw
    string prefix check is not enough). The requested path is canonicalised FIRST —
    ``Path.resolve()`` collapses every ``..`` segment and follows every symlink to
    its real target — and the containment test runs SECOND, against that already
    real path, component-wise via ``Path.is_relative_to``.
    """
    if "\0" in requested:
        raise RootsDenied(requested, requested, "null byte in path", "bad_path")

    candidate = Path(requested)
    if not candidate.is_absolute():
        candidate = _PACKAGE_DIR / candidate
    real_target = candidate.resolve()  # FIRST: collapse `..`, follow symlinks

    # SERVER-OWNED FLOOR — checked before we even ask the client for its roots.
    # However broad the client's declared roots are, a readings path must resolve
    # inside this server's own data directory. This is the narrowest fence that
    # still does the job: read the bundled sample, or an alternative readings file
    # deliberately placed alongside it. Nothing outside `_ALLOWED_DATA_ROOTS` is
    # opened, even when a declared root would otherwise cover it.
    if not any(real_target.is_relative_to(allowed) for allowed in _ALLOWED_DATA_ROOTS):
        raise RootsDenied(
            requested,
            str(real_target),
            f"path resolves outside the server's data directory ({_PACKAGE_DIR})",
            "outside_server_dir",
        )

    if not ctx.request_context.session.check_client_capability(
        types.ClientCapabilities(roots=types.RootsCapability())
    ):
        raise RootsDenied(
            requested, str(real_target), "client declared no roots capability", "no_capability"
        )

    # roots/list is an outbound request that round-trips to the client: log it as a
    # timed external boundary, same shape as data_load_started / data_load_completed.
    await log.event("info", "roots_list_started", target="roots/list")
    _t0 = time.perf_counter()
    try:
        declared = (await ctx.request_context.session.list_roots()).roots
    except Exception as exc:  # NoBackChannelError / MCPError / ... — cannot verify, so deny
        await log.event(
            "warning",
            "roots_list_completed",
            target="roots/list",
            outcome="failure",
            error_class=type(exc).__name__,
            duration_ms=round((time.perf_counter() - _t0) * 1000, 2),
        )
        raise RootsDenied(
            requested, str(real_target), f"roots/list failed: {type(exc).__name__}", "list_failed"
        ) from exc
    await log.event(
        "info",
        "roots_list_completed",
        target="roots/list",
        outcome="success",
        root_count=len(declared),
        duration_ms=round((time.perf_counter() - _t0) * 1000, 2),
    )

    if not declared:
        raise RootsDenied(
            requested, str(real_target), "client declared an empty roots list", "empty_list"
        )

    for root in declared:
        try:
            root_real = _root_uri_to_path(root.uri).resolve()
        except (ValueError, OSError):
            continue
        if real_target.is_relative_to(root_real):  # SECOND: component-wise containment
            return real_target

    raise RootsDenied(
        requested, str(real_target), "resolved path is outside every declared root", "outside_roots"
    )


async def _log_roots_denied(log: "_InvocationLogger", denied: RootsDenied) -> None:
    """The one place a denial is logged. Stable event name `roots_denied`, always
    carrying the requested path; `deny_by_default` marks the requirement-4 case
    where the client declared no roots at all and we refused rather than opening
    up unrestricted access."""
    await log.event(
        "warning",
        "roots_denied",
        error_class=type(denied).__name__,
        category=denied.category,
        deny_by_default=denied.deny_by_default,
        requested_path=denied.requested,
        resolved_path=denied.resolved,
        reason=denied.reason,
    )


async def _open_gated_readings(
    ctx: Context, log: "_InvocationLogger", source: str | None
) -> list[dict]:
    """THE single filesystem entry point for every tool and resource in this module.

    `source` is the caller's optional path override; when it is None we do NOT
    quietly fall back to reading the bundled sample unchecked — we run that path
    through the very same root check. So a client that has declared no roots reads
    nothing at all, bundled data included (requirement 4: deny by default rather
    than allow everything).

    Raises :class:`RootsDenied` on refusal — never returns an unvalidated path,
    never opens a file the client's roots do not cover.
    """
    requested = source if source is not None else str(_DATA_FILE)
    gated_path = await _resolve_within_client_roots(ctx, requested, log)
    return await _load_readings_logged(log, gated_path)


@mcp.tool()
async def verify_kpi_movement(
    ctx: Context,
    kpi: Annotated[
        str,
        Field(
            min_length=1,
            max_length=100,
            description="KPI name or keyword, e.g. 'churn' or 'Monthly Revenue'. "
            "Matched case-insensitively against the tracked KPI names.",
        ),
    ],
    period: Annotated[
        str,
        Field(
            min_length=7,
            max_length=7,
            pattern=r"^\d{4}-\d{2}$",
            description="The month whose movement you are checking, as YYYY-MM, e.g. '2026-07'.",
        ),
    ],
    baseline_period: Annotated[
        str | None,
        Field(
            min_length=7,
            max_length=7,
            pattern=r"^\d{4}-\d{2}$",
            description="The month to compare against, as YYYY-MM. Defaults to the "
            "calendar month immediately before `period`.",
        ),
    ] = None,
    threshold_pct: Annotated[
        float,
        Field(
            ge=0.0,
            le=100.0,
            description="How large the percent change must be, in absolute value, to "
            "count as a significant swing. Defaults to 15.",
        ),
    ] = 15.0,
    source: Annotated[
        str | None,
        Field(
            max_length=1024,
            description="Optional path to an alternative readings JSON file — absolute, "
            "or relative to the server directory. It must resolve to a real path inside "
            "one of the roots the client has declared, or the call is denied. Omit to "
            "use the bundled sample data.",
        ),
    ] = None,
) -> dict:
    """Check whether a KPI's month-over-month move is big enough to actually alert on.

    Use this before you tell the owner a number "jumped", "dropped", "spiked" or
    "fell off a cliff" — any time you are about to raise a flag because a KPI changed
    a lot between two months. It pulls both months' real readings, computes the true
    percent change, and tells you whether that change clears the alert threshold and
    whether it moved in a good or bad direction for that KPI.

    Call it whenever the owner asks "is this change real / should I be worried about
    this", or whenever a weekly summary is about to call something out as a
    significant swing and you need to confirm it first. Do not use it to judge whether
    a KPI is healthy overall — that is a separate question. This only sizes one
    period-over-period move.
    """
    log = _InvocationLogger(ctx, "verify_kpi_movement")
    baseline = baseline_period or prior_month(period)
    # log.correlation_id is minted here and stamped on every line below.
    await log.event(
        "info",
        "tool_started",
        period=period,
        baseline_period=baseline,
        threshold_pct=threshold_pct,
        kpi_query=kpi,
    )

    try:
        # EVERY read goes through the one gate — the caller's `source` when given,
        # the bundled sample otherwise. Denial is a returned error result, never a
        # raised exception (requirement 3).
        try:
            readings = await _open_gated_readings(ctx, log, source)
        except RootsDenied as denied:
            await _log_roots_denied(log, denied)
            await log.event(
                "info",
                "tool_completed",
                outcome="denied",
                stage="roots_check",
                duration_ms=log.elapsed_ms(),
            )
            target = f"'{source}'" if source is not None else "the bundled readings file"
            return {
                "found": False,
                "error": "roots_denied",
                "requested_source": source,
                "message": f"Access to {target} was denied: {denied.reason}. The file must "
                "resolve inside the server's own data directory AND inside a root the client "
                "has declared; a client that declares no roots gets no filesystem access at all.",
            }

        known = sorted({r["kpi_name"] for r in readings})

        q = kpi.strip().lower()

        # The name-resolution scan is this tool's one real iteration: exactly one
        # unit of work per tracked KPI name, so the total is genuine. The shared
        # reporter reads the caller's progressToken and stays silent if there was
        # none — same behaviour as before progress existed.
        progress = _ProgressReporter(ctx, total=len(known))

        exact: list[str] = []
        substring: list[str] = []
        for name in known:
            await progress.step(f"checking KPI: {name}")
            if name.lower() == q:
                exact.append(name)
            if q in name.lower():
                substring.append(name)
        matched = exact or substring

        if len(matched) != 1:
            reason = "no tracked KPI matches that name" if not matched else "the keyword matches more than one KPI"
            await log.event(
                "info",
                "kpi_unresolved",
                match_reason="no_match" if not matched else "ambiguous",
                candidate_count=len(matched or known),
            )
            await log.event(
                "info", "tool_completed", outcome="not_found", stage="kpi_resolution", duration_ms=log.elapsed_ms()
            )
            return {
                "found": False,
                "kpi": kpi,
                "period": period,
                "baseline_period": baseline,
                "candidates": matched or known,
                "message": f"Could not verify movement for '{kpi}': {reason}. "
                f"Candidates: {', '.join(matched or known)}.",
            }

        name = matched[0]
        by_period = {r["period"]: r for r in readings if r["kpi_name"] == name}
        current_row, baseline_row = by_period.get(period), by_period.get(baseline)

        if current_row is None or baseline_row is None:
            missing = [p for p, row in ((period, current_row), (baseline, baseline_row)) if row is None]
            await log.event(
                "info",
                "reading_unavailable",
                missing_period_count=len(missing),
                available_period_count=len(by_period),
            )
            await log.event(
                "info", "tool_completed", outcome="not_found", stage="reading_lookup", duration_ms=log.elapsed_ms()
            )
            return {
                "found": False,
                "kpi": name,
                "period": period,
                "baseline_period": baseline,
                "available_periods": sorted(by_period),
                "message": f"'{name}' has no reading for {', '.join(missing)}. "
                f"Available periods: {', '.join(sorted(by_period)) or 'none'}.",
            }

        current_value = current_row["current_value"]
        baseline_value = baseline_row["current_value"]
        direction = current_row.get("direction", "higher_is_better")
        unit = current_row.get("unit", "")

        absolute_change = round(current_value - baseline_value, 4)
        if baseline_value == 0:
            percent_change = None
            exceeds = absolute_change != 0
        else:
            percent_change = round(absolute_change / abs(baseline_value) * 100, 1)
            exceeds = abs(percent_change) >= threshold_pct

        if absolute_change == 0:
            favorable = None
        elif direction == "lower_is_better":
            favorable = absolute_change < 0
        else:
            favorable = absolute_change > 0

        if not exceeds or favorable is None:
            verdict = "NOT_SIGNIFICANT"
        elif favorable:
            verdict = "SIGNIFICANT_FAVORABLE"
        else:
            verdict = "SIGNIFICANT_UNFAVORABLE"

        significant = verdict.startswith("SIGNIFICANT")
        pct_text = "n/a (baseline is zero)" if percent_change is None else f"{percent_change:+.1f}%"
        direction_text = "" if favorable is None else f", {'favorable' if favorable else 'unfavorable'} direction"

        await log.event(
            "info",
            "movement_evaluated",
            verdict=verdict,
            exceeds_threshold=exceeds,
            movement_is_significant=significant,
            favorable=favorable,
        )
        await log.event(
            "info", "tool_completed", outcome="success", stage="movement_evaluation", duration_ms=log.elapsed_ms()
        )
        return {
            "found": True,
            "kpi_name": name,
            "period": period,
            "baseline_period": baseline,
            "current_value": current_value,
            "baseline_value": baseline_value,
            "unit": unit,
            "direction": direction,
            "absolute_change": absolute_change,
            "percent_change": percent_change,
            "threshold_pct": threshold_pct,
            "exceeds_threshold": exceeds,
            "movement_is_significant": significant,
            "favorable": favorable,
            "verdict": verdict,
            "message": f"{name} moved {pct_text} ({baseline_value}{unit} -> {current_value}{unit}) "
            f"from {baseline} to {period}; threshold {threshold_pct:g}% -> "
            f"{'significant' if significant else 'not significant'}{direction_text}.",
        }
    except Exception as exc:
        # Caught boundary: record a stable error_class, then let it propagate — the
        # framework still turns it into a proper tool error for the caller.
        await log.event("error", "tool_failed", error_class=type(exc).__name__, duration_ms=log.elapsed_ms())
        raise


# --- assess_monthly_risk: the reasoning tool ---------------------------------
# Everything above the sampling call is deterministic: it loads the readings and
# runs kpi_analysis over them, no model involved. The judgement — which concerns
# matter and how to phrase them for the owner — is delegated to the CLIENT's model
# via MCP sampling. This server names no model and holds no API key; both belong
# to whichever client is connected.

_RISK_SYSTEM_PROMPT = (
    "You are a financial analyst giving a small business owner a short monthly read "
    "on their KPIs. They are not a data person. You are handed a digest in which the "
    "month-over-month change, target status and trend are ALREADY computed — use "
    "those numbers, do not recompute them. Pick the two to four KPIs that most "
    "deserve the owner's attention, worst first; for each, one plain sentence on "
    "what changed and why it matters to the business. Finish with one sentence on "
    "the overall picture. No markdown, no headings, at most four items, and do not "
    "walk through every KPI."
)
# Enough for ~4 short bullets plus a wrap-up sentence; keeps the client's cost and
# latency bounded. The client may still return fewer tokens or cap it lower.
_RISK_MAX_TOKENS = 600


async def _degraded_return(
    base_result: dict,
    summary: dict,
    reason: str,
    log: "_InvocationLogger",
    progress: "_ProgressReporter",
) -> dict:
    """Assemble the non-crashing fallback: the full deterministic digest plus a
    rule-based briefing. Used whenever the client model step cannot run. The
    caller has already emitted the `warning` log line naming `reason`."""
    await progress.step("assembling the rule-based briefing")
    await log.event(
        "info", "tool_completed", outcome="degraded", stage="sampling", duration_ms=log.elapsed_ms()
    )
    return {
        **base_result,
        "briefing": render_rule_based_brief(summary, reason),
        "briefing_source": "rule_based_fallback",
        "degraded": True,
        "degraded_reason": reason,
        "sampling": None,
    }


@mcp.tool()
async def assess_monthly_risk(
    ctx: Context,
    period: Annotated[
        str,
        Field(
            min_length=7,
            max_length=7,
            pattern=r"^\d{4}-\d{2}$",
            description="The month to brief on, as YYYY-MM, e.g. '2026-07'.",
        ),
    ],
) -> dict:
    """Give the owner a prioritised, plain-English read on the month: which KPIs
    should worry them most, and why.

    Use this when the owner asks "how are we doing this month", "what should I
    worry about", or wants the monthly summary — anything that needs the KPIs
    weighed against each other and explained, not just one number checked. It
    reads every KPI's reading for the month itself (it does not guess the data),
    computes each one's month-over-month move and target gap, then asks the
    calling client's model to turn that into a short briefing.

    It does not grade a single KPI's health (use kpi_health_check) and it does not
    decide an alert threshold (use verify_kpi_movement). If the client cannot run
    the model step, the result still carries the full deterministic digest and a
    rule-based briefing; the `briefing_source` field says which one you got.
    """
    log = _InvocationLogger(ctx, "assess_monthly_risk")
    await log.event("info", "tool_started", period=period)

    # Four real phases: load readings, score them, get the model briefing, assemble.
    # The slow one is the model briefing, but the phase count itself is genuine, so
    # this is a real total — not an invented percentage.
    progress = _ProgressReporter(ctx, total=4)

    try:
        # (1) Fetch + crunch the real data ourselves. No model call in this block.
        # This tool has no path parameter — it only ever wants the bundled sample —
        # but it still reads through the one gate, so a client that declared no
        # roots gets a denial here too rather than silent filesystem access.
        await progress.step(f"loading KPI readings for {period}")
        try:
            readings = await _open_gated_readings(ctx, log, None)
        except RootsDenied as denied:
            await _log_roots_denied(log, denied)
            await log.event(
                "info", "tool_completed", outcome="denied", stage="roots_check", duration_ms=log.elapsed_ms()
            )
            return {
                "found": False,
                "error": "roots_denied",
                "period": period,
                "message": f"Access to the bundled readings file was denied: {denied.reason}. "
                "The file must resolve inside the server's own data directory AND inside a root "
                "the client has declared; a client that declares no roots gets no filesystem "
                "access at all.",
            }
        summary = summarize_period(readings, period)
        await progress.step(f"scoring {summary['kpi_count']} KPI(s) against target and prior month")

        if summary["kpi_count"] == 0:
            available = sorted({r["period"] for r in readings})
            await log.event("info", "period_empty", period=period, available_period_count=len(available))
            await log.event(
                "info", "tool_completed", outcome="not_found", stage="period_summary", duration_ms=log.elapsed_ms()
            )
            return {
                "found": False,
                "period": period,
                "available_periods": available,
                "message": f"No KPI readings recorded for {period}. "
                f"Available months: {', '.join(available) or 'none'}.",
            }

        digest_text = build_digest_text(summary)
        base_result = {
            "found": True,
            "period": period,
            "baseline_period": summary["baseline_period"],
            "kpi_count": summary["kpi_count"],
            "risk_level": summary["risk_level"],
            "deterministic_digest": summary["kpis"],
        }

        # (2) Delegate the judgement to the client's model via MCP sampling.
        if not ctx.request_context.session.check_client_capability(
            types.ClientCapabilities(sampling=types.SamplingCapability())
        ):
            reason = "client does not support MCP sampling"
            await log.event("warning", "sampling_unavailable", reason=reason)
            return await _degraded_return(base_result, summary, reason, log, progress)

        await log.event(
            "info", "sampling_request_started", max_tokens=_RISK_MAX_TOKENS, kpi_count=summary["kpi_count"]
        )
        await progress.step("waiting for your client's model to write the briefing")
        started = time.perf_counter()
        try:
            # >>> THE SAMPLING REQUEST LEAVES THE SERVER FOR THE CLIENT ON THE NEXT LINE <<<
            completion = await ctx.request_context.session.create_message(
                messages=[
                    types.SamplingMessage(
                        role="user",
                        content=types.TextContent(type="text", text=digest_text),
                    )
                ],
                system_prompt=_RISK_SYSTEM_PROMPT,
                max_tokens=_RISK_MAX_TOKENS,
            )
        except Exception as exc:
            # Client refused, has no back-channel, timed out, or errored. Not fatal:
            # degrade to the rule-based briefing and warn.
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            reason = f"sampling request failed ({type(exc).__name__})"
            await log.event(
                "warning",
                "sampling_request_completed",
                outcome="failure",
                error_class=type(exc).__name__,
                duration_ms=duration_ms,
            )
            return await _degraded_return(base_result, summary, reason, log, progress)

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        content = completion.content
        text = content.text.strip() if getattr(content, "type", None) == "text" and content.text else ""
        await log.event(
            "info",
            "sampling_request_completed",
            outcome="success" if text else "empty_result",
            stop_reason=completion.stop_reason,
            client_reported_model=completion.model,  # the CLIENT's choice, echoed back — not set here
            duration_ms=duration_ms,
        )
        if not text:
            reason = "client returned an empty or non-text completion"
            await log.event("warning", "sampling_empty_result", reason=reason)
            return await _degraded_return(base_result, summary, reason, log, progress)

        await progress.step("assembling the briefing")
        await log.event(
            "info", "tool_completed", outcome="success", stage="sampling", duration_ms=log.elapsed_ms()
        )
        return {
            **base_result,
            "briefing": text,
            "briefing_source": "client_model",
            "degraded": False,
            "degraded_reason": None,
            "sampling": {
                "client_reported_model": completion.model,
                "stop_reason": completion.stop_reason,
                "duration_ms": duration_ms,
            },
        }
    except Exception as exc:
        await log.event("error", "tool_failed", error_class=type(exc).__name__, duration_ms=log.elapsed_ms())
        raise


# --- check_live_kpi_dashboard: the one tool that reads a real running system ----
# The two tools above read a bundled JSON sample. This one calls the PROJECT'S OWN
# backend — the Express service from STORY-003 — at GET /api/kpis, the same
# endpoint the React dashboard uses. It answers exactly one question:
#
#   "What KPIs is the live dashboard serving right now — from which uploaded file,
#    generated when, and is anything still waiting on clarification?"
#
# Requirement notes, inline:
#  1. The only model-influenced value is `kpi`. It is NEVER put in the request
#     path (that is the constant `_KPIS_PATH`); it rides as an httpx-encoded query
#     parameter and is re-applied as a client-side filter on the parsed result.
#  2. Every phase of the call has an explicit timeout; a fired timeout returns a
#     clear `timed_out` result and logs `error_class="TimeoutError"`.
#  3. Every failure path — including the catch-all — RETURNS an error result
#     ({"ok": false, "error": ...}); nothing raises out of the tool, so one bad
#     call cannot drop the stdio connection.
#  4. Base URL and token come from the environment only; neither, nor any host,
#     appears in source, in a log line, or in an error returned to the caller.
#  5. The outbound connection is the pooled, process-wide `_get_http_client()`;
#     only this call's Response is released, in a `finally`.
#  6. Progress notifications on all three phases; every log line carries the
#     invocation correlation id via `_InvocationLogger`.


@mcp.tool()
async def check_live_kpi_dashboard(
    ctx: Context,
    kpi: Annotated[
        str | None,
        Field(
            max_length=100,
            description="Optional KPI name or keyword, e.g. 'revenue' or 'margin'. "
            "When given, only KPIs whose key or label contains it (case-insensitive) "
            "are returned. Omit to get every KPI currently on the dashboard.",
        ),
    ] = None,
) -> dict:
    """Read what the live KPI dashboard is showing right now, straight from the
    running backend (GET /api/kpis — the STORY-003 endpoint the React dashboard uses).

    Use this to answer "what does the dashboard say today", "which uploaded file are
    the current numbers from", "is anything waiting on clarification", or to check one
    KPI's value as the owner actually sees it. Unlike verify_kpi_movement /
    assess_monthly_risk, this reads the PROJECT'S OWN service over HTTP rather than the
    bundled sample, so it reflects the most recent real upload. It does not compute
    month-over-month movement and it writes nothing.

    Needs KPI_COPILOT_API_BASE_URL set in the environment. On any failure it returns
    {"ok": false, "error": ...} with a message — it never raises.
    """
    log = _InvocationLogger(ctx, "check_live_kpi_dashboard")
    await log.event("info", "tool_started", kpi_query=kpi or "")
    # Three real phases: resolve config, make the HTTP call, parse the response.
    progress = _ProgressReporter(ctx, total=3)

    try:
        # (1) Config from the environment ONLY — nothing hardcoded, nothing logged.
        await progress.step("resolving the KPI Copilot API endpoint")
        base_url = (os.environ.get(_API_BASE_URL_ENV) or "").strip()
        if not base_url:
            await log.event("warning", "not_configured", missing_env=_API_BASE_URL_ENV)
            await log.event(
                "info", "tool_completed", outcome="not_configured", duration_ms=log.elapsed_ms()
            )
            return {
                "ok": False,
                "error": "not_configured",
                "message": f"Set the {_API_BASE_URL_ENV} environment variable to the base "
                "URL of the KPI Copilot backend, then retry.",
            }

        # Fence the destination scheme: the job needs an http(s) URL with a host.
        # Reject file://, ftp://, a bare host with no scheme, etc. The host itself
        # is operator-chosen (env only) and not restricted further here, but the
        # scheme is — this tool must never hand a non-HTTP URL to the client.
        parsed = urlparse(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            await log.event("warning", "bad_base_url", scheme=parsed.scheme or "(none)")
            await log.event(
                "info", "tool_completed", outcome="bad_base_url", duration_ms=log.elapsed_ms()
            )
            return {
                "ok": False,
                "error": "bad_base_url",
                "message": f"{_API_BASE_URL_ENV} must be an http:// or https:// URL with a "
                f"host (got scheme '{parsed.scheme or 'none'}'). Fix the environment "
                "variable and retry.",
            }

        headers = {"Accept": "application/json"}
        token = os.environ.get(_API_TOKEN_ENV)
        if token:
            # Built here only; never logged, never returned in an error result.
            headers["Authorization"] = f"Bearer {token}"

        # (2) The one outbound call. `kpi` rides as an ENCODED query param; the
        #     path stays the constant `_KPIS_PATH`. Explicit timeout on the call.
        url = base_url.rstrip("/") + _KPIS_PATH
        params = {"kpi": kpi} if kpi else None
        client = _get_http_client()

        await log.event(
            "info", "http_request_started", target=f"GET {_KPIS_PATH}", has_filter=bool(kpi)
        )
        await progress.step("requesting GET /api/kpis from the backend")
        started = time.perf_counter()
        response = None
        try:
            response = client.get(url, params=params, headers=headers, timeout=_HTTP_TIMEOUT)
            status_code = response.status_code
            body_text = response.text
        except httpx2.TimeoutException as exc:
            await log.event(
                "error",
                "http_request_failed",
                error_class="TimeoutError",
                timeout_kind=type(exc).__name__,
                duration_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            await log.event(
                "info", "tool_completed", outcome="timed_out", duration_ms=log.elapsed_ms()
            )
            return {
                "ok": False,
                "error": "timed_out",
                "error_class": "TimeoutError",
                "message": "The KPI Copilot backend did not respond within the timeout. It "
                "may be starting up or overloaded; retry shortly.",
            }
        except httpx2.RequestError as exc:
            await log.event(
                "error",
                "http_request_failed",
                error_class=type(exc).__name__,
                duration_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            await log.event(
                "info", "tool_completed", outcome="unreachable", duration_ms=log.elapsed_ms()
            )
            return {
                "ok": False,
                "error": "unreachable",
                "message": "Could not reach the KPI Copilot backend. Confirm it is running "
                "and that the configured base URL is correct.",
            }
        finally:
            # Release THIS call's response; the pooled connection stays open for
            # the next call to reuse (requirement 5).
            if response is not None:
                response.close()

        await log.event(
            "info",
            "http_request_completed",
            outcome="success" if status_code == 200 else "http_error",
            status_code=status_code,
            duration_ms=round((time.perf_counter() - started) * 1000, 2),
        )

        # (3) Parse and shape the answer.
        await progress.step("parsing the dashboard response")

        if status_code != 200:
            # Pass through the backend's OWN typed error body if present — its
            # messages are fixed strings and carry no host or secret.
            upstream_class = upstream_msg = None
            try:
                err_json = json.loads(body_text)
                upstream_class = err_json.get("errorClass")
                upstream_msg = err_json.get("message")
            except (ValueError, AttributeError):
                pass
            await log.event(
                "info",
                "tool_completed",
                outcome="upstream_error",
                status_code=status_code,
                duration_ms=log.elapsed_ms(),
            )
            return {
                "ok": False,
                "error": "upstream_error",
                "statusCode": status_code,
                "upstreamErrorClass": upstream_class,
                "message": upstream_msg
                or f"The backend returned HTTP {status_code} for {_KPIS_PATH}.",
            }

        try:
            payload = json.loads(body_text)
        except ValueError as exc:
            await log.event(
                "error", "response_parse_failed", error_class=type(exc).__name__, duration_ms=log.elapsed_ms()
            )
            await log.event(
                "info", "tool_completed", outcome="bad_response", duration_ms=log.elapsed_ms()
            )
            return {
                "ok": False,
                "error": "bad_response",
                "message": "The backend responded 200 but the body was not valid JSON.",
            }

        if payload.get("status") == "no_data":
            await log.event("info", "dashboard_read", has_data=False, kpi_count=0)
            await log.event(
                "info", "tool_completed", outcome="success", duration_ms=log.elapsed_ms()
            )
            return {
                "ok": True,
                "hasData": False,
                "status": "no_data",
                "message": "The live dashboard has no KPI data yet — no file has been "
                "uploaded and processed on the running backend.",
            }

        all_kpis = payload.get("kpis") or []
        q = (kpi or "").strip().lower()
        selected = (
            [
                k
                for k in all_kpis
                if q in str(k.get("key", "")).lower() or q in str(k.get("label", "")).lower()
            ]
            if q
            else all_kpis
        )
        shaped = [
            {
                "key": k.get("key"),
                "label": k.get("label"),
                "value": k.get("value"),
                "unit": k.get("unit"),
                "evidenceLevel": k.get("evidenceLevel"),
                "evidenceNote": k.get("evidenceNote"),
            }
            for k in selected
        ]

        clarifications = payload.get("clarificationsNeeded") or []
        await log.event(
            "info",
            "dashboard_read",
            has_data=True,
            kpi_count=len(all_kpis),
            matched_count=len(shaped),
            overall_status=payload.get("status"),
            clarification_count=len(clarifications),
        )
        await log.event("info", "tool_completed", outcome="success", duration_ms=log.elapsed_ms())

        result = {
            "ok": True,
            "hasData": True,
            "status": payload.get("status"),
            "filename": payload.get("filename"),
            "generatedAt": payload.get("generatedAt"),
            "kpiCount": len(all_kpis),
            "kpis": shaped,
            "clarificationsNeeded": clarifications,
            "summary": payload.get("summary"),
        }
        if q and not shaped:
            result["message"] = f"No live KPI matches '{kpi}'. Available keys: " + ", ".join(
                str(k.get("key", "?")) for k in all_kpis
            )
        return result

    except Exception as exc:
        # Requirement 3: never let this escape and kill the stdio connection.
        await log.event(
            "error", "tool_failed", error_class=type(exc).__name__, duration_ms=log.elapsed_ms()
        )
        return {
            "ok": False,
            "error": "internal_error",
            "error_class": type(exc).__name__,
            "message": "The tool hit an unexpected internal error and returned safely "
            "instead of dropping the connection.",
        }


async def _resource_readings(ctx: Context, component: str, source: str | None = None) -> list[dict]:
    """Resource-side wrapper around the one filesystem gate (`_open_gated_readings`).

    On denial it emits the same stable `roots_denied` warning (carrying the
    requested path) and then raises `ResourceError` — the SDK's *anticipated*
    failure path, which returns a clean protocol error to the client and logs at
    INFO without a traceback, rather than surfacing as a crash. That is the
    resource-handler equivalent of requirement 3's "return an error result rather
    than throwing": a resource cannot return a value that isn't its content, so
    `ResourceError` is how it signals a handled refusal.
    """
    log = _InvocationLogger(ctx, component)
    try:
        return await _open_gated_readings(ctx, log, source)
    except RootsDenied as denied:
        await _log_roots_denied(log, denied)
        raise ResourceError(
            f"Filesystem access denied: {denied.reason}. The readings file must resolve "
            "inside the server's own data directory AND inside a root the client has "
            "declared; a client that declares no roots gets no filesystem access at all."
        ) from denied


# `kpi://readings` is registered as a template (`{?source}`, an optional query
# variable) rather than a static resource for one concrete reason: in this SDK a
# static resource handler is called with no arguments and no Context injected
# (see the `Context injection for static resources is not supported` guard in
# mcpserver/server.py), so it could not reach `ctx.session.list_roots()` to run
# the roots check. A template handler can. A plain `kpi://readings` read still
# works — the client just omits the `?source` query variable and it defaults to
# the bundled sample, gated the same way.
@mcp.resource(
    "kpi://readings{?source}",
    mime_type="application/json",
    description="Every stored KPI reading across all periods, as a JSON array. "
    "Use this to discover which KPIs are tracked and which months have data. "
    "Optional ?source=<path> reads an alternative readings JSON file instead; it "
    "must resolve to a real path inside one of the client's declared roots.",
)
async def all_readings(ctx: Context, source: str | None = None) -> list[dict]:
    """Read-only: the full readings collection, unfiltered.

    Routed through the shared roots gate like every other filesystem read here —
    the default bundled file included, so a client that has declared no roots is
    denied rather than served. `?source` is an optional path override, gated the
    same way.
    """
    return await _resource_readings(ctx, "all_readings", source)


@mcp.resource(
    "kpi://readings/{period}",
    mime_type="application/json",
    description="Every KPI reading recorded for one month, e.g. kpi://readings/2026-07. "
    "One handler serves every period.",
)
async def readings_for_period(ctx: Context, period: str) -> list[dict]:
    """Read-only: the readings whose period matches the {period} in the URI (YYYY-MM).

    The {period} URI variable is passed as the `period` argument; `ctx` is
    injected so the read can go through the shared roots gate (`_resource_readings`)
    — the same enforcement every other filesystem read in this server uses.
    Returns an empty array if no reading exists for that month — a normal miss,
    not an error.
    """
    rows = await _resource_readings(ctx, "readings_for_period")
    return [r for r in rows if r["period"] == period]


# kpi_health_check returns one expanded string. A multi-turn workflow could instead
# return a list of typed prompt messages (alternating user / assistant turns) — the
# MCPServer prompt API accepts that shape too. One string is enough for this one.
@mcp.prompt(
    title="KPI health check",
    description="Assess whether one KPI is healthy, at risk, or critical for a given "
    "month, using the stored readings and the verify_kpi_movement tool.",
)
def kpi_health_check(
    kpi: Annotated[
        str,
        Field(
            min_length=1,
            max_length=100,
            description="KPI name or keyword to assess, e.g. 'Customer Churn Rate' or 'churn'.",
        ),
    ],
    period: Annotated[
        str,
        Field(
            min_length=6,
            max_length=7,
            pattern=r"^(latest|\d{4}-\d{2})$",
            description="Month to focus on as YYYY-MM, or 'latest' for the most recent month on record.",
        ),
    ] = "latest",
) -> str:
    """Render the instruction that drives a single-KPI health assessment.

    A prompt does not call the tool or read the resource itself — it returns the
    user message that tells the model to do so, in order, and how to grade what
    comes back. Wording is based on prompts/score-kpi-health/v1.2.0.
    """
    focus = "the most recent month on record" if period == "latest" else f"the month {period}"
    header = f'Assess the health of the KPI matching "{kpi}" for {focus}.\n'
    body = """
You are a KPI health analyst for a small business owner. The owner is not a data
person — they need a quick, honest read on whether one number is fine or a problem,
not a dashboard.

Workflow — do these in order:

1. GET THE DATA. Read the resource kpi://readings/<focus month> and find the row
   whose kpi_name matches the requested KPI (case-insensitive; if several match,
   pick the closest and say which). Use only the numbers the resource returns —
   do not estimate or recall them. When the focus is "latest", first read
   kpi://readings to find the newest month that has a row for this KPI.

2. GET THE PRIOR PERIOD. From kpi://readings, take the same KPI's row for the
   calendar month immediately before the focus month, for the trend comparison.

3. CONFIRM ANY BIG SWING. If current vs. previous looks like a large move, call the
   verify_kpi_movement tool (kpi=<the KPI>, period=<focus month>) and use its
   verdict to decide whether the change is real before relying on it.

4. GRADE IT, using these rules:

   Direction rule:
   - "direction" tells you which way is good. If "higher_is_better", a bigger
     current_value than target_value is meeting/beating target, and a bigger
     current_value than previous_value is an improving trend.
   - If "lower_is_better" (e.g. churn rate, error rate), the comparisons flip.

   Status — choose exactly one:
   - "healthy": meets or beats target (per direction), AND the trend vs.
     previous_value is flat or improving.
   - "at_risk": close to target but has not met it, OR meets it only barely while
     the trend is worsening.
   - "critical": well short of target (a large gap, not a close miss), especially
     when the trend is also worsening.
   - "insufficient_data": use whenever you cannot responsibly judge health. This
     overrides everything above.

   Score:
   - 0-100, consistent with status: 80-100 for healthy, 40-69 for at_risk, 0-30
     for critical. Exactly null when status is "insufficient_data".
   - Do not let one strong factor push the score to the extreme edge of its band
     by itself. Weigh margin over target AND trend together.

5. NOTHING MATCHES. If step 1 finds no row for this KPI in the focus month, or
   target_value is not set, do not guess — return status "insufficient_data",
   score null, and a rationale naming what was missing.

Worked examples (different KPIs — they show the scoring pattern, not the answer):

  Thin margin, improving trend: Website Uptime, current 99.5%, target 99.4%,
  previous 99.1%, higher_is_better ->
  {"status": "healthy", "score": 72, "rationale": "Uptime is just above target and
  improved from last period, but the margin over target is thin."}

  Large gap, worsening trend: Support Ticket Backlog, current 340, target 150,
  previous 260, lower_is_better ->
  {"status": "critical", "score": 22, "rationale": "The backlog is far above target
  and has grown substantially from the prior period."}

  Close to target, slightly worsening: Average Response Time, current 4.3h, target
  4.0h, previous 4.1h, lower_is_better ->
  {"status": "at_risk", "score": 58, "rationale": "Response time is close to target
  but hasn't met it, and has drifted slightly worse from last period."}

Output contract:
Respond with ONLY a single JSON object — no markdown fences, no text around it,
exactly these three fields:
{"status": "healthy" | "at_risk" | "critical" | "insufficient_data",
 "score": <number or null>,
 "rationale": "<one plain-English sentence>"}
"""
    return header + body


# --- send_kpi_alert_to_slack: the outbound Slack adapter ------------------------
# The integration picked from .colaberry/plan.json's system list: clearest value
# (REQ-005 needs alerts to actually reach owners; STORY-004 already built
# everything up to the send) and the least setup of any system there — one
# Incoming Webhook URL in an env var, no OAuth, no token refresh, no scopes.


@mcp.tool()
async def send_kpi_alert_to_slack(
    ctx: Context,
    summary: Annotated[
        str,
        Field(
            min_length=1,
            max_length=300,
            description="One-line headline for the alert, e.g. 'Revenue fell 22% "
            "month-over-month'. Plain text.",
        ),
    ],
    details: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=200)]],
        Field(
            max_length=20,
            description="Optional supporting lines, one per KPI or point; each becomes a "
            "bullet. Up to 20 items, 200 characters each.",
        ),
    ] = None,
    severity: Annotated[
        Literal["info", "warning", "critical"],
        Field(description="Controls the emoji/prefix. Default 'warning'."),
    ] = "warning",
    dedup_key: Annotated[
        str | None,
        Field(
            max_length=200,
            description="Stable identifier for THIS alert event (e.g. STORY-004's "
            "deriveAlertKey, which folds in generatedAt). When given, the exact same "
            "event is never posted twice for the life of the server process. When "
            "omitted, only an accidental repeat of the same wording within 10 minutes "
            "is suppressed — a genuine later recurrence that reads identically IS sent.",
        ),
    ] = None,
) -> dict:
    """Post a KPI alert to the team's Slack channel via an Incoming Webhook.

    This is the real outbound Slack leg of REQ-005 ("send alerts ... via email and
    Slack"). Use it once you have a headline worth the owner's attention and,
    optionally, a few supporting lines — e.g. after verify_kpi_movement confirms a
    significant swing. It does not decide *whether* something is alert-worthy; that
    is the caller's job.

    Needs KPI_COPILOT_SLACK_WEBHOOK_URL set in the environment. On any failure it
    returns {"ok": false, "error": ...} with a message — it never raises.

    Dedupe: pass `dedup_key` to identify the event — that event is posted at most
    once per process. Without it, only a same-wording retry inside a 10-minute
    window is suppressed, so a real re-alert later is NOT silently dropped. Either
    way a suppressed call returns {"ok": true, "deduped": true}.
    """
    log = _InvocationLogger(ctx, "send_kpi_alert_to_slack")
    details = details or []
    await log.event("info", "tool_started", severity=severity, detail_count=len(details))
    # Two real phases: validate + resolve config, then the one outbound POST.
    progress = _ProgressReporter(ctx, total=2)

    try:
        # (1) VALIDATE BEFORE DOING ANYTHING. The schema already enforced types,
        #     lengths and the severity enum at the framework boundary; here we
        #     check the things it can't and confirm the integration is configured.
        await progress.step("validating the alert and resolving Slack config")
        text = _slack_text(summary, details, severity)
        if len(text) > _SLACK_TEXT_MAX:
            await log.event("warning", "invalid_input", reason="assembled_text_too_long", length=len(text))
            await log.event("info", "tool_completed", outcome="invalid_input", duration_ms=log.elapsed_ms())
            return {
                "ok": False,
                "error": "invalid_input",
                "message": f"The assembled message is {len(text)} characters, over the "
                f"{_SLACK_TEXT_MAX} limit. Send fewer or shorter lines.",
            }

        webhook = (os.environ.get(_SLACK_WEBHOOK_ENV) or "").strip()
        if not webhook:
            await log.event("warning", "not_configured", missing_env=_SLACK_WEBHOOK_ENV)
            await log.event("info", "tool_completed", outcome="not_configured", duration_ms=log.elapsed_ms())
            return {
                "ok": False,
                "error": "not_configured",
                "message": f"Set {_SLACK_WEBHOOK_ENV} to a Slack Incoming Webhook URL "
                "(Slack -> Apps -> Incoming Webhooks), then retry.",
            }

        parsed = urlparse(webhook)
        if parsed.scheme != "https" or parsed.netloc != _SLACK_HOST:
            await log.event(
                "warning", "bad_webhook_url",
                scheme=parsed.scheme or "(none)", host=parsed.netloc or "(none)",
            )
            await log.event("info", "tool_completed", outcome="bad_webhook_url", duration_ms=log.elapsed_ms())
            return {
                "ok": False,
                "error": "bad_webhook_url",
                "message": f"{_SLACK_WEBHOOK_ENV} must be an https://{_SLACK_HOST}/... URL. "
                "Fix the environment variable and retry.",
            }

        # (2) Idempotency. An explicit dedup_key means "this exact event" — deduped
        #     for the whole process. Without one, the key is the wording, and a hit
        #     only counts as a duplicate inside the 10-minute window, so a genuine
        #     later re-alert that happens to read the same is NOT swallowed.
        key = _slack_dedup_key(dedup_key, summary, details, severity)
        prev_ts = _SLACK_SENT.get(key)
        if prev_ts is not None and (
            key.startswith("k:") or (time.time() - prev_ts) <= _SLACK_DEDUP_WINDOW_S
        ):
            reason = "same event key" if key.startswith("k:") else "same wording within 10 min"
            await log.event(
                "info", "tool_completed", outcome="deduped", dedup_reason=reason,
                duration_ms=log.elapsed_ms(),
            )
            return {
                "ok": True,
                "deduped": True,
                "message": f"Not re-sent ({reason}); an equivalent alert already went out.",
            }

        # (3) The one outbound call. Explicit bounded timeout on every phase, so a
        #     slow or hung Slack cannot stall the server. Any failure RETURNS an
        #     error result — nothing raises out of this tool.
        await progress.step("posting the alert to Slack")
        client = _get_http_client()
        await log.event("info", "http_request_started", target="POST hooks.slack.com")
        started = time.perf_counter()
        response = None
        try:
            response = client.post(webhook, json={"text": text}, timeout=_SLACK_TIMEOUT)
            status_code = response.status_code
            body_text = response.text[:200]
        except httpx2.TimeoutException as exc:
            await log.event(
                "error", "http_request_failed", error_class="TimeoutError",
                timeout_kind=type(exc).__name__,
                duration_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            await log.event("info", "tool_completed", outcome="timed_out", duration_ms=log.elapsed_ms())
            return {
                "ok": False,
                "error": "timed_out",
                "error_class": "TimeoutError",
                "message": "Slack did not respond within the timeout. The alert was NOT "
                "posted; retry shortly.",
            }
        except httpx2.RequestError as exc:
            await log.event(
                "error", "http_request_failed", error_class=type(exc).__name__,
                duration_ms=round((time.perf_counter() - started) * 1000, 2),
            )
            await log.event("info", "tool_completed", outcome="unreachable", duration_ms=log.elapsed_ms())
            return {
                "ok": False,
                "error": "unreachable",
                "message": "Could not reach Slack (network error or DNS failure). The alert "
                "was NOT posted; check connectivity and retry.",
            }
        finally:
            if response is not None:
                response.close()

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        if status_code != 200 or body_text.strip().lower() != "ok":
            await log.event(
                "warning", "http_request_completed", outcome="rejected",
                status_code=status_code, duration_ms=duration_ms,
            )
            await log.event("info", "tool_completed", outcome="rejected", duration_ms=log.elapsed_ms())
            return {
                "ok": False,
                "error": "rejected",
                "status_code": status_code,
                "slack_response": body_text,
                "message": f"Slack rejected the alert (HTTP {status_code}: {body_text!r}). "
                "The webhook may be revoked or malformed. The alert was NOT posted.",
            }

        _SLACK_SENT[key] = time.time()
        _SLACK_SENT.move_to_end(key)  # most-recently-sent stays newest for the LRU cap
        while len(_SLACK_SENT) > _SLACK_SENT_MAX:
            _SLACK_SENT.popitem(last=False)
        await log.event(
            "info", "http_request_completed", outcome="success",
            status_code=status_code, duration_ms=duration_ms,
        )
        await log.event("info", "tool_completed", outcome="success", duration_ms=log.elapsed_ms())
        return {
            "ok": True,
            "deduped": False,
            "severity": severity,
            "lines_posted": 1 + len(details),
            "message": "Alert posted to Slack.",
        }

    except Exception as exc:
        # Requirement 3: never let this escape and kill the stdio connection.
        await log.event("error", "tool_failed", error_class=type(exc).__name__, duration_ms=log.elapsed_ms())
        return {
            "ok": False,
            "error": "internal_error",
            "error_class": type(exc).__name__,
            "message": "The tool hit an unexpected internal error and returned safely "
            "instead of dropping the connection.",
        }


def main() -> None:
    """Run kpi-copilot over STDIO.

    STDIO transport contract: stdout carries ONLY framed JSON-RPC. Every
    diagnostic must reach stderr or the MCP logging channel
    (``notifications/message`` via ``ctx.log``) — never ``print()``. This
    function makes that explicit so a stray stdlib logger cannot corrupt the
    message stream, and so shutdown is clean.

      * stdlib logging is pinned to stderr (any dependency that logs — httpx2,
        asyncio — lands there, not on stdout).
      * ``KeyboardInterrupt`` is swallowed so Ctrl-C / client teardown exits 0.
      * the process-wide HTTP pool is released by ``_close_http_client`` (already
        registered with ``atexit``) on the way out.

    Transport rationale and the rejected Streamable-HTTP alternative:
    ``docs/TRANSPORT_DECISION.md``.
    """
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    try:
        mcp.run(transport="stdio")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
