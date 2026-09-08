# KPI Copilot — MCP Server Build Notes

A readable record of the session where this server was scaffolded, built, gated in
the MCP Inspector, and registered with Claude Code. Kept so it can be re-read later.

- **Project:** Small Business KPI Copilot
- **Server folder:** `mcp-servers/kpi-copilot/`
- **Sessions:** 2026-08-27 → 2026-08-31
- **Format below:** each step shows *what was asked* (paraphrased), *what was done*, and
  the concrete commands / files / decisions.

---

## 0. Environment reality (read this first)

In this environment the `mcp` package is **version 2.1.0**, and its decorator-based
server class is **`MCPServer`** (`from mcp.server import MCPServer`) — **not**
`FastMCP`. There is no `mcp.server.fastmcp` module here. Course material that says
"FastMCP instance" means `MCPServer` in this SDK.

Prerequisites checked (all PASS):

| Tool | Needed | Found |
|---|---|---|
| Python | ≥ 3.10 | 3.14.5 |
| Node | for the MCP Inspector | v24.19.0 (npm 11.17.0) |
| uv | project manager | 0.12.5 |

`uv` is at `C:\Users\pamym\.local\bin\uv.exe`. The `claude` CLI is **not** on PATH
(VS Code bundles its own runtime), so MCP registration was done by writing
`.mcp.json` directly rather than `claude mcp add`.

---

## 1. The MCP surface (primitive map)

**Asked:** find where the project needs data/actions it can't reach today, pick the
single most valuable one, and propose exactly one tool + one resource + one prompt.

**Most valuable gap:** the copilot's `prompts/score-kpi-health/` work needs KPI
readings that today are pasted in by hand. There is no persisted KPI data yet
(STORY-002 not built). So: expose the readings and drive a health check off them.

| name | primitive | initiator | why |
|---|---|---|---|
| `verify_kpi_movement` | **tool** | model | Model calls it mid-reasoning; it *computes a verdict* (is a month-over-month swing big enough to alert on) — the REQ-013 guardrail before an alert. |
| `kpi://readings/{period}` | **resource** | application | Pure read, URI-addressed, `application/json`; the host pulls one month's readings into context deliberately. |
| `kpi_health_check` | **prompt** | user | Human triggers it by name; a saved workflow that reads the resource, runs the tool on big swings, returns the fixed status/score/rationale shape the evals grade. |

Rules of thumb used:
- read-only ⇒ **resource** with a URI + MIME type, never a tool
- changes state / does work ⇒ **tool**, with constrained inputs
- repeatable workflow a human triggers by name ⇒ **prompt**

---

## 2. Bare server + Inspector (CP1 setup)

**Asked:** confirm the server starts, then open the MCP Inspector against it, starting
from a *bare* server.

The existing `server.py` was a full learning server (tool + 2 resources + prompt).
Chosen path: **back it up, strip in place.**

```bash
cp server.py server_full.py.bak      # full version preserved here
```

Bare `server.py`:

```python
from mcp.server import MCPServer
mcp = MCPServer("kpi-copilot")
if __name__ == "__main__":
    mcp.run(transport="stdio")
```

- **Name it publishes:** `kpi-copilot`
- **Transport:** stdio

Boot check (silence = success — a stdio server prints nothing and waits):

```bash
uv run python server.py < /dev/null   # exit 0, no output = good
```

Launch the Inspector (SDK CLI is installed via `mcp[cli]`, so use `mcp dev`, not the
standalone `npx @modelcontextprotocol/inspector`):

```bash
uv run mcp dev server.py
```

It prints a URL like `http://127.0.0.1:6274?MCP_INSPECTOR_API_TOKEN=…`. **The token
rotates every launch** — don't bother saving it. If it fails with "PORT IS IN USE",
a previous Inspector is still running; kill the PID on ports 6274/6275/6278 and
relaunch.

**Empty panel, correctly:** header shows **Connected** (green) + server name
`kpi-copilot`; Tools / Resources / Prompts each render an empty "no items" state
with count 0. Broken instead looks like a red "Disconnected" / error banner or a
stack trace — the tell is the connection status, not the empty lists.

---

## 3. The tool — `verify_kpi_movement`

**Asked:** implement the tool row for real, constrain every input, write the docstring
as a "when to use me" instruction, return structured data, return a structured empty
result on a miss (no exception).

**Sample data created:** `kpi_readings.sample.json` (18 readings, 2026-05…2026-08).
KPIs mirror the project's `workflow-plan.md`: Monthly Revenue, Customer Churn Rate,
Customer Satisfaction Score, Cash on Hand, Gross Margin Percent, Overdue Invoices,
New Feature Adoption Rate. Each row: `kpi_name`, `period` (YYYY-MM), `current_value`,
`target_value` (nullable), `previous_value` (nullable), `unit`, `direction`. The tool
re-reads this file on every call. Replace it with real cleaned output once STORY-002
lands.

**Signature & input constraints** (line numbers in `server.py`):

| Arg | Type | Constraints | Lines |
|---|---|---|---|
| `kpi` | `str` | `min_length=1`, `max_length=100` | ~44–45 |
| `period` | `str` | `min_length=7`, `max_length=7`, `pattern=^\d{4}-\d{2}$` | ~53–55 |
| `baseline_period` | `str \| None` | same as `period`; default `None` → prior calendar month | ~62–64 |
| `threshold_pct` | `float` | `ge=0.0`, `le=100.0`, default `15.0` | ~72–73 |

**Docstring (approved):** "Check whether a KPI's month-over-month move is big enough
to actually alert on. Use this before you tell the owner a number 'jumped',
'dropped', 'spiked'… Do not use it to judge whether a KPI is healthy overall — that
is a separate question. This only sizes one period-over-period move."

**Returns** a dict with named fields: `found`, `kpi_name`, `period`,
`baseline_period`, `current_value`, `baseline_value`, `unit`, `direction`,
`absolute_change`, `percent_change`, `threshold_pct`, `exceeds_threshold`,
`movement_is_significant`, `favorable`, `verdict`
(`SIGNIFICANT_UNFAVORABLE` / `SIGNIFICANT_FAVORABLE` / `NOT_SIGNIFICANT`), `message`.

**Miss** → `{"found": false, …, "candidates": [...], "message": "..."}`, never an
exception.

**Known-good calls:**
- `kpi="churn", period="2026-07"` → Customer Churn Rate, baseline 2026-06,
  6.2 → 8.5 = **+37.1%**, `verdict = SIGNIFICANT_UNFAVORABLE`.
- `kpi="overdue invoices", period="2026-07"` → 4200 → 9600 = **+128.6%**,
  `SIGNIFICANT_UNFAVORABLE`.
- `kpi="Monthly Revenue", period="2026-07"` → +10.6%, below threshold →
  `NOT_SIGNIFICANT`.

**CP1 break test:** call with `kpi=""` (empty). Expected: a validation error
(`too_short` / "at least 1 character") **before the body runs** — no tool result at
all. That's a pass: `min_length=1` rejects the input at the MCP boundary. A Python
traceback there would be the bug.

---

## 4. The resources

**Asked:** expose the resource row at a stable readable URI, declare an explicit MIME
type, and add a template if data has many addressable items. Handlers must be
read-only.

| URI | MIME type | Kind | Returns |
|---|---|---|---|
| `kpi://readings` | `application/json` | fixed | all 18 readings, as a JSON array |
| `kpi://readings/{period}` | `application/json` | **template** | readings for one month (7 for `2026-07`); `[]` for an unknown month, no error |

- **Scheme choice:** `kpi://` names the domain; `readings` is the collection;
  `{period}` (YYYY-MM) is the addressable key, matching the tool's `period` arg.
- Both handlers only call `_load_readings()` (opens the JSON file for reading) — no
  writes, no state mutation. They are genuinely read-only, so they belong as
  resources, not tools.

**Verify in Inspector:** Resources tab → *List Resources* shows `kpi://readings`;
the *Resource Templates* section shows `kpi://readings/{period}` with a `period`
field. Content should come back as a real JSON array, not an escaped string.

---

## 5. The prompt — `kpi_health_check`

**Asked:** add the prompt row; ≥1 argument with a sensible default; body encodes the
real workflow (which tool, which resource, what to produce, what to do on no match);
base the wording on the tested Week 4 prompt if one fits.

- **Wording basis:** `prompts/score-kpi-health/v1.2.0` (most-developed version of that
  line — direction rule, status rules, score bands, all three worked examples carried
  near-verbatim). v1.3.0 (margin-percentage scale) is the alternative.
- **Args:** `kpi` (required, 1–100 chars); `period` (default `"latest"`, else
  `YYYY-MM`, `pattern=^(latest|\d{4}-\d{2})$`).
- **Body:** 5 numbered steps — (1) read `kpi://readings/<month>`, (2) read
  `kpi://readings` for the prior month, (3) call `verify_kpi_movement` on big swings,
  (4) grade with the v1.2.0 rules, (5) if no row / no target → return
  `insufficient_data`, `score null`, don't guess. Ends with the JSON output contract.
- **Returns** a single expanded **string** (`header + body`). A comment above the
  decorator notes that a multi-turn workflow could return a list of typed
  user/assistant messages instead.
- **"Won't render" cause #1:** a `{placeholder}` in the template that isn't a declared
  function arg. This one only substitutes `kpi` and `period`, both declared.

---

## 6. CP2 gate (all three primitives)

Relaunch: `uv run mcp dev server.py` → open the printed URL → **Connect** (STDIO).
After any code change, click **Restart** in the Inspector before re-testing.

- **Tools:** `verify_kpi_movement` with `kpi=overdue invoices`, `period=2026-07` →
  `verdict: SIGNIFICANT_UNFAVORABLE`, `percent_change: 128.6`, `baseline_period`
  auto-filled `2026-06`.
- **Resources:** `kpi://readings` (18 objects) and template `kpi://readings/{period}`
  with `2026-07` (7 objects) — both `application/json`.
- **Prompts:** `kpi_health_check` with `kpi=Customer Churn Rate`, `period=2026-07` →
  user message starting `Assess the health of the KPI matching "Customer Churn Rate"
  for the month 2026-07.`

When all three tabs are green, **screenshot the Inspector** — that screenshot is the
week's assignment proof.

**One-line summary:** *"It's a little local service that lets Claude pull our KPI
numbers, check whether a month-to-month change is big enough to worry about, and run
a standard health check on any single KPI."*

---

## 7. Registering with Claude Code

`claude` CLI isn't on PATH, so registration = a file at the repo root:

**`.mcp.json`** (project root):

```json
{
  "mcpServers": {
    "kpi-copilot": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "C:\\Users\\pamym\\Downloads\\AI Accelerator Program\\Colaberry AL Project\\mcp-servers\\kpi-copilot",
        "python",
        "server.py"
      ]
    }
  }
}
```

- **Absolute path is mandatory.** Claude Code launches the server from its own cwd;
  `uv --directory <abspath>` lets uv find this project's `.venv` / `pyproject.toml`.
  A relative path is the classic "registers fine, never connects" bug.
- Verified: the command runs clean from an unrelated directory (`C:\Windows`).

**In a new Claude Code session in this folder:** approve the prompt *"New MCP server
found in .mcp.json: kpi-copilot"*, then run **`/mcp`** — expect:

```
kpi-copilot   connected
   Tools:     1   (verify_kpi_movement)
   Resources: 2   (kpi://readings, kpi://readings/{period})
   Prompts:   1   (kpi_health_check)
```

If it says `failed`: `uv` probably isn't on the PATH Claude Code inherits — change
`"command"` to `C:\\Users\\pamym\\.local\\bin\\uv.exe`.

**Prompt as a slash command:** `/mcp__kpi-copilot__kpi_health_check`

**Colleague-style test question** (only answerable by calling the tool):
> "Our overdue invoices went up from June to July — was that a big enough jump to
> actually flag, or just normal month-to-month movement?"

### Claude Desktop instead

Edit `%APPDATA%\Claude\claude_desktop_config.json`, add the same block under
`"mcpServers"` (doubled backslashes required), then **fully quit and restart** the
app (from the tray, not just the window).

---

## 8. Cost & lifecycle

- The stdio server is a **local process with no running cost.** No API calls when
  idle. Claude Code spawns it on session start and **kills it on session exit** — no
  daemon is left behind. Nothing to "disconnect" to save money.
- Keeping it *registered* adds only its small schema (1 tool + 2 resources + 1
  prompt) to context each turn — a few hundred tokens. It costs nothing extra unless
  Claude actually calls the tool.
- The thing worth stopping when you're done: the **MCP Inspector** (`uv run mcp dev`),
  which lingers and holds ports 6274/6275. Still free, just tidy-up.

---

## File map

| File | Purpose |
|---|---|
| `server.py` | the MCP server — 3 tools, 2 resources, 1 prompt |
| `scratchpad/probe_live_dashboard.py` | stdio probe for `check_live_kpi_dashboard` against a running backend |
| `kpi_readings.sample.json` | sample KPI readings the server reads (replace when STORY-002 lands) |
| `server_full.py.bak` | the original full learning server, pre-strip |
| `../../.mcp.json` | Claude Code registration (repo root) |
| `docs/BUILD_NOTES.md` | this file |

---

## Running log

Newest entries at the bottom. One entry per working session that changes the server,
its data, its registration, or how it's used. Sections 0–8 above stay as the
reference; this log is the "what happened when" trail.

### 2026-08-31 — consolidated the build into this doc; started the running log

- Walked the **CP2 gate** in the MCP Inspector: tool, both resources, and the prompt
  all verified green (see §6 for the exact clicks and expected values).
- **Registered with Claude Code** by writing `.mcp.json` at the repo root (§7) —
  server name `kpi-copilot`, absolute-path `uv run --directory … python server.py`.
  Confirmed the command starts clean from an unrelated cwd.
- Answered a cost/lifecycle question (§8): the stdio server has no running cost and
  is killed on session exit; only the Inspector needs manual stopping.
- Created this file and this running-log section. From here on, each session's MCP
  work gets appended here.
- **Server state unchanged this session:** still 1 tool / 2 resources / 1 prompt,
  sample data untouched.

<!-- APPEND NEW SESSION ENTRIES BELOW THIS LINE -->

### 2026-08-31 — added progress notifications to `verify_kpi_movement`

- **Why:** `verify_kpi_movement` is the only tool in the registered server, so it is
  the longest-running one by default. Its one genuine iteration is the scan over the
  tracked-KPI catalog during name resolution — that loop is now instrumented.
- **How (`server.py`):**
  - `from mcp.server.mcpserver import Context`; tool is now `async def` with a leading
    `ctx: Context` param. The framework auto-detects the `Context` annotation and
    strips it from the public input schema (`find_context_parameter` → `skip_names`),
    so the wire signature stays `kpi, period, baseline_period, threshold_pct`.
  - Read the progress token from request `_meta`:
    `ctx.request_context.meta.get("progress_token")` — at runtime `meta` is a plain
    `dict` (`{}` when the client sent no token), **not** a pydantic model, and the key
    is snake_case `progress_token`, not `progressToken`.
  - The name-match one-liner is now an explicit `for scanned, name in enumerate(known,
    start=1)` loop. Per iteration, **only when a token is present**, it emits
    `await ctx.report_progress(scanned, total_kpis, f"checking KPI {scanned}/{total_kpis}: {name}")`
    — running count, real total (`len(known)`), human-readable per-unit message.
  - Matching semantics preserved exactly: `exact or substring` == old
    `[... == q] or [... in ...]` (same sorted order, exact-before-substring priority).
    No return value changed.
- **Verified** over stdio with a `progress_callback` client:
  - with token → 7 notifications, `(1.0, 7.0, "checking KPI 1/7: Cash on Hand")` …
    `(7.0, 7.0, "checking KPI 7/7: Overdue Invoices")`
  - without token → 0 notifications, result text byte-identical, miss path still
    returns `found: false` (no exception)
  - `tools/list` input schema: `['baseline_period', 'kpi', 'period', 'threshold_pct']`
    (no `ctx`)
  - User confirmed the progress rows visible in the MCP Inspector History pane.
- **SDK note:** `mcp` 2.1.0. `ctx.report_progress()` is already a documented no-op
  without a token (`DispatchContext.progress()` early-returns on
  `self._progress_token is None`); the explicit token guard here is deliberate, per
  the task requirement to read the token and gate on it in the handler.
- **Server surface unchanged:** still 1 tool / 2 resources / 1 prompt, sample data
  untouched.

### 2026-08-31 — structured log notifications

- **Why:** give `verify_kpi_movement` real observability — one correlation id per
  invocation, structured payloads (never sentences), a line at each boundary.
- **How (`server.py`):**
  - **Capability declared at construction.** `MCPServer` has no constructor switch
    for logging; the low-level server advertises the `logging` capability *iff* a
    `logging/setLevel` handler is registered (`get_capabilities()` keys off handler
    presence). So: `mcp._lowlevel_server.add_request_handler("logging/setLevel",
    types.SetLevelRequestParams, _accept_log_level)` right after construction. Doing
    it via `add_request_handler` (not the `on_set_logging_level=` constructor kwarg)
    avoids the `MCPDeprecationWarning`. Without the declaration the client silently
    drops every `notifications/message` — nothing errors, code looks broken.
  - `_InvocationLogger(ctx, tool)` — mints one `uuid4` `correlation_id`, stamps
    `{service, tool, correlation_id}` on every line, owns the invocation clock
    (`elapsed_ms()`). `event(level, name, **fields)` → `ctx.log(level, {"event":
    name, ...}, logger_name="kpi-copilot")`.
  - Boundaries logged: `tool_started`; `data_load_started` / `data_load_completed`
    (`duration_ms`, `row_count`); `kpi_unresolved`; `reading_unavailable`;
    `movement_evaluated`; `tool_completed` (`outcome`, `stage`, `duration_ms`) on
    every non-error exit; `tool_failed` (`error_class`, `duration_ms`) on a caught
    exception, then **re-raised** so the framework still returns a proper tool error.
  - Payload hygiene: identifiers / counts / durations / enums only. The KPI keyword
    (`kpi_query`) is logged (business identifier, not a secret); the actual KPI
    numbers (`current_value` / `baseline_value`) are **not**.
- **SDK notes (`mcp` 2.1.0):**
  - Protocol logging is deprecated for the 2026-07-28 handshake (SEP-2577); the
    negotiated `2025-11-25` still delivers every level unconditionally
    (`allowed_log_levels()` returns all levels for non-modern versions). Module-level
    `warnings.filterwarnings("ignore", category=MCPDeprecationWarning)` silences the
    per-call warning — this also covers `list_roots()` below.
  - `ctx.request_context.meta` is a plain `dict` at runtime (already relied on for
    progress).
- **Verified** over stdio with a `logging_callback` client: `initialize` advertises
  `logging: {}`, `set_logging_level("debug")` round-trips; one shared `correlation_id`
  per call and disjoint ids across calls; corrupting the data file produced
  `tool_failed` with `error_class: "JSONDecodeError"` and `is_error: True`.
  User confirmed the log rows in the Inspector.
- **Event vocabulary:** `tool_started`, `data_load_started`, `data_load_completed`,
  `kpi_unresolved`, `reading_unavailable`, `movement_evaluated`, `tool_completed`,
  `tool_failed` (+ `roots_denied`, added below).

### 2026-08-31 — filesystem roots enforcement

- **Why:** let a caller point `verify_kpi_movement` at an alternative readings file
  (`source` param) without letting it read outside the client's declared roots.
- **How (`server.py`):**
  - New optional tool param `source: str | None` (≤1024 chars). Omitted → bundled
    `kpi_readings.sample.json` (ships in the package dir, not caller-controlled, not
    gated). Supplied → gated before any `open()`.
  - `_resolve_within_client_roots(ctx, requested)` — **resolve FIRST, compare
    SECOND.** `Path.resolve()` collapses every `..` and follows every symlink to its
    real target; then `Path.is_relative_to(root_real)` does component-wise
    containment against each client root (`roots/list`, `file://` URI → real path via
    `urlparse` + `url2pathname` + `unquote`, then `.resolve()`).
  - A code comment spells out why a raw-string prefix check is unsafe: `<root>/../../
    etc/passwd`, a symlink `<root>/link` → outside, and the sibling `<root>-secret/x`
    all pass `startswith(<root>)` as text.
  - Fail closed: no `roots` capability, `roots/list` error, empty root list, or path
    outside every root → `RootsDenied`.
  - On denial: **returns** `{"found": false, "error": "roots_denied",
    "requested_source", "message"}` (never throws) and emits a `warning`
    `roots_denied` log with `requested_path`, `resolved_path`, `reason`;
    `tool_completed` logs `outcome="denied"`, `stage="roots_check"`.
  - `_load_readings` / `_load_readings_logged` now take an optional `path` (default
    `_DATA_FILE`); the two resources are unchanged (they read only the bundled file,
    no caller-controlled path — nothing to gate).
- **SDK notes:** `session.list_roots()` is deprecated (SEP-2577) but works on
  `2025-11-25` (warning already suppressed). `session.check_client_capability(
  ClientCapabilities(roots=RootsCapability()))` gates the call. `Path.is_relative_to`
  returns `False` (never raises) for unrelated / different-drive paths.
- **Verified** with a scripted client declaring `roots=[<kpi-copilot dir>]`: allowed
  (relative + absolute inside root); denied (dot-dot traversal → `C:\Windows\win.ini`;
  absolute outside; `../kpi-copilot-secret/x.json` sibling-prefix bypass; empty roots
  list); `source` omitted still works. OS symlink case not run automatically (needs
  Windows Developer Mode/admin) — same `.resolve()` path as the dot-dot case; manual
  Inspector steps handed to the user.
- **Server surface:** `verify_kpi_movement` gains one optional param `source`;
  still 1 tool / 2 resources / 1 prompt.

### 2026-09-03 — added `assess_monthly_risk` (reasoning tool via MCP sampling) — session CC-20260903-k7m2

- **Why:** the server so far only does lookup + deterministic arithmetic. Added one
  tool that needs *judgement*: a prioritised, plain-English monthly read on which
  KPIs should worry the owner and why. The judgement is delegated to the connected
  client's model via **MCP sampling** — the server names no model and holds no key.
- **Split (Modular Composition Rule):** the judgement-free half moved to a new
  **`kpi_analysis.py`** (no MCP, no I/O): `summarize_period` (per-KPI MoM math +
  target gap + rule-based `severity`, sorted worst-first, `risk_level` rollup),
  `build_digest_text` (compact model-facing view), `render_rule_based_brief`
  (degraded fallback text). `_prior_month` moved there as `prior_month` and
  `verify_kpi_movement` now imports it (only behavioural touch to the existing tool;
  re-verified `churn`/`2026-07` → `+37.1%`, `SIGNIFICANT_UNFAVORABLE`, unchanged).
- **`server.py` — `assess_monthly_risk(period: YYYY-MM)`:**
  - **(1) fetches its own data**: `_load_readings_logged` + `summarize_period`. No
    model call in this block. Empty month → `{found: false, available_periods, …}`,
    no exception.
  - **(2) requests a completion through the client**: `ctx.request_context.session
    .create_message(messages=[user: digest_text], system_prompt=_RISK_SYSTEM_PROMPT,
    max_tokens=_RISK_MAX_TOKENS=600)`. **The request leaves the server at
    `server.py:544`** (marker comment on line 543).
  - **No key / no model name anywhere** — `grep -nE "api_key|claude-|gpt-|
    model_preferences|anthropic|openai|os\.environ" server.py kpi_analysis.py` → none.
    `create_message` is passed only messages/system_prompt/max_tokens.
    `sampling.client_reported_model` in the return is `completion.model` echoed back
    (the *client's* choice), never set here.
  - **Degraded path (req 4):** no `sampling` capability → `warning`
    `sampling_unavailable`; client raises/refuses/times out → caught, `warning`
    `sampling_request_completed outcome=failure`; empty/non-text completion →
    `warning` `sampling_empty_result`. All three return the full deterministic
    `deterministic_digest` + a non-empty rule-based `briefing`, with
    `degraded: true`, `degraded_reason`, `briefing_source: "rule_based_fallback"`.
    Never raises, never returns a blank answer.
  - **Sampling log lines (req 5):** `sampling_request_started` (`max_tokens`,
    `kpi_count`) before the call; `sampling_request_completed` (`outcome`,
    `stop_reason`, `client_reported_model`, `duration_ms`) after — `info` on success,
    `warning` on failure. Both carry the invocation `correlation_id` via
    `_InvocationLogger`.
- **Verified** (`scratchpad/probe_sampling.py`, stdio, 3 clients):
  - **A. supports sampling** → `briefing_source: client_model`, `degraded: false`,
    model text returned, `sampling.duration_ms` set; logs `sampling_request_started`
    → `sampling_request_completed outcome=success`.
  - **B. supports sampling but refuses** (callback returns `ErrorData` → `MCPError`)
    → `briefing_source: rule_based_fallback`, `degraded_reason: "sampling request
    failed (MCPError)"`, full briefing, `is_error: false`; `sampling_request_started`
    → `sampling_request_completed` (**warning**, `outcome=failure`, `duration_ms`).
  - **C. no sampling capability** → `briefing_source: rule_based_fallback`,
    `degraded_reason: "client does not support MCP sampling"`; single `warning`
    `sampling_unavailable`.
  - `kpi_analysis` unit tests: `uv run python test_kpi_analysis.py` → 26/26 pass
    (happy path, no-target → `unknown`, zero baseline → `percent_change None` no
    `ZeroDivisionError`, empty month, `risk_level` rollup, fallback never blank).
  - Boot check `uv run python server.py < /dev/null` → exit 0.
- **Server surface:** now **2 tools** (`verify_kpi_movement`, `assess_monthly_risk`)
  / 2 resources / 1 prompt. New files: `kpi_analysis.py`, `test_kpi_analysis.py`.
- **Follow-up:** `server.py` is 745 lines (soft ceiling 300 / hard 500). This change
  extracted rather than added bulk; the next touch should move the two resources +
  the prompt out to their own modules.

### 2026-09-03 — instrumented the roots/list outbound call as a timed boundary — session CC-20260903-9r4t

- **Why:** audited the structured-log layer (built 2026-08-31, extended 2026-09-03)
  against the five-point spec. Four of five were already met server-wide. The one
  gap: `verify_kpi_movement`'s `source=` path calls
  `ctx.request_context.session.list_roots()` — an outbound request that round-trips
  to the client — but only the *denial* was logged. A successful roots resolution
  emitted nothing, so req 3 ("external call started / finished with duration") was
  not satisfied for that boundary.
- **How (`server.py`, `_resolve_within_client_roots`):**
  - Now takes the invocation's `_InvocationLogger` so its lines carry the same
    `correlation_id` as the rest of the call.
  - Wraps the `list_roots()` call: `roots_list_started` (`target="roots/list"`)
    before; `roots_list_completed` after — `info` / `outcome="success"` /
    `root_count` / `duration_ms` on success, `warning` / `outcome="failure"` /
    `error_class` / `duration_ms` if the client errors. Same shape as
    `data_load_started` / `data_load_completed`.
  - `roots_denied` now also carries `error_class="RootsDenied"` (req 4: every
    caught error logged with a stable class name, not just a message).
- **Scope checked, deliberately not changed:** static resources (`kpi://readings`)
  cannot take a `Context` param in `mcp` 2.1.0 — `MCPServer.resource()` raises
  "Context injection for static resources is not supported" — so they cannot emit
  `notifications/message`. The template resource and the prompt do no external I/O
  beyond the bundled sample file. The two tools are the instrumented surface.
- **Verified** over stdio with a `logging_callback` client
  (`scratchpad/probe_logs.py`, `probe_denied.py`):
  - Happy path, no `source` → 5 lines, one `correlation_id`: `tool_started` →
    `data_load_started` → `data_load_completed` (`duration_ms`, `row_count=18`) →
    `movement_evaluated` → `tool_completed` (`outcome=success`, `duration_ms`).
  - Happy path, `source` inside a declared root → 7 lines, same `correlation_id`,
    with `roots_list_started` → `roots_list_completed` (`outcome=success`,
    `root_count=1`, `duration_ms`) inserted after `tool_started`.
  - Traversal outside the root → `roots_list_completed(success)` →
    `roots_denied` (`error_class=RootsDenied`, `resolved_path`, `reason`) →
    `tool_completed(outcome=denied)`; `is_error=False` (denial is a result).
  - No roots capability → `roots_denied(error_class=RootsDenied)` with NO
    `roots_list_*` lines (no outbound call was made — correct).
  - `initialize` advertises `logging` capability; boot check `server.py < /dev/null`
    exit 0; `test_kpi_analysis.py` 26/26.
- **Event vocabulary (full):** `tool_started`, `roots_list_started`,
  `roots_list_completed`, `roots_denied`, `data_load_started`,
  `data_load_completed`, `kpi_unresolved`, `reading_unavailable`,
  `movement_evaluated`, `sampling_request_started`, `sampling_request_completed`,
  `sampling_unavailable`, `sampling_empty_result`, `period_empty`,
  `tool_completed`, `tool_failed`.
- **Server surface unchanged:** 2 tools / 2 resources / 1 prompt, sample data
  untouched.

### 2026-09-03 — one shared progress helper `_ProgressReporter`, covering both tools — session CC-20260903-k7m2

- **Why:** `verify_kpi_movement` had inline progress from an earlier session;
  `assess_monthly_risk` had none but its model-sampling step is the one operation
  in this server that routinely exceeds ~2s. Consolidated both onto one helper.
- **`_ProgressReporter` (server.py, sits next to `_InvocationLogger`):**
  - Reads the caller's `progressToken` once from `ctx.request_context.meta`
    (`progress_token`). No token ⇒ every method is a no-op; nothing emitted, tool
    behaves exactly as before. (`ctx.report_progress` is itself already a no-op
    without a token; the explicit gate is kept per the task requirement.)
  - `step(message, *, advance=1.0)` bumps a running count and emits one
    `notifications/progress`. Constructed with `total=<n>` when the unit count is
    genuine → reports `count/n`. Constructed with no `total` when the amount of
    work is genuinely unknowable up front → emits `count` with `total=None` and
    appends " — total not known up front" to the message. **No current tool needs
    the no-total mode** (both have real totals); the helper supports it so the
    rule is enforced in one place.
- **`verify_kpi_movement`:** the name-resolution scan (one iteration per tracked
  KPI) now drives `_ProgressReporter(ctx, total=len(known))` — real total. Deleted
  the local `progress_token` read and the inline `ctx.report_progress` call. Loop
  body, match order and return value all unchanged.
- **`assess_monthly_risk`:** `_ProgressReporter(ctx, total=4)` — four real phases:
  `loading KPI readings` → `scoring N KPI(s)` → `waiting for your client's model to
  write the briefing` (emitted right before `create_message`) → `assembling the
  briefing`. The degraded/refusal paths tick their final step inside
  `_degraded_return` (now takes the reporter). Empty-month path ticks 1–2 then
  returns. No return statement touched.
- **Verified** (`scratchpad/probe_progress.py`, stdio):
  - `verify_kpi_movement` with a progress callback → **7 ticks, every one `k/7.0`**,
    `1..7`; without a callback → **0 ticks**, return byte-identical.
  - `assess_monthly_risk` with a callback → **4 ticks, `k/4.0`**, `1..4`; without →
    **0 ticks**; returns equal after dropping the wall-clock `sampling.duration_ms`.
  - `assess_monthly_risk` for an empty month → 2 ticks then `found: false`, no crash.
  - `probe_sampling.py` (3 sampling scenarios) still green; `test_kpi_analysis.py`
    26/26; boot check exit 0.
- **Most ticks in the Inspector:** `verify_kpi_movement` (7, one per KPI) beats
  `assess_monthly_risk` (4). Call it with any `kpi` / `period` and a progressToken.
- **Server surface unchanged:** 2 tools / 2 resources / 1 prompt.


### 2026-09-03 — roots enforcement made server-wide: one gate on every filesystem read — session CC-20260903-r3n8

- **Why:** only `verify_kpi_movement`'s `source` arg was gated. `assess_monthly_risk`
  and both `kpi://readings*` resources read the bundled sample with a bare
  `open()`, and nothing denied file access when the client declared no roots.
- **One helper, one choke point (`server.py`):**
  - `_resolve_within_client_roots(ctx, requested, log)` — unchanged control flow:
    canonicalise the path FIRST (`Path.resolve()` collapses `..`, follows
    symlinks), containment test SECOND via `Path.is_relative_to` (whole path
    components). Module comment spells out why `raw.startswith(root)` is unsafe
    (`..` escape, symlink target, `<root>-secret/` sibling).
  - **NEW `_open_gated_readings(ctx, log, source)`** — the single filesystem entry
    point. `source=None` does NOT fall back to an unchecked bundled read; it runs
    `str(_DATA_FILE)` through the very same root check. `_load_readings` /
    `_load_readings_logged` are now marked INTERNAL, reachable only through it.
  - **NEW `_log_roots_denied(log, denied)`** — the one place `roots_denied` is
    logged. Stable event name, always carries `requested_path`; new fields
    `category` (`no_capability|empty_list|list_failed|outside_roots|bad_path`) and
    `deny_by_default` (true for the two no-roots cases → requirement 4).
  - `RootsDenied` gained `.category` and `.deny_by_default`.
- **Routed through the gate:** `verify_kpi_movement` (both the `source` arg and the
  default), `assess_monthly_risk` (default read), `all_readings`, `readings_for_period`.
- **Resource shape change:** `kpi://readings` is now a **template**
  `kpi://readings{?source}` (was a static resource). Static resource handlers get
  no `Context` in this SDK — `mcpserver/server.py` explicitly refuses a `ctx`
  param on a variable-less URI — so it could not reach `ctx.session.list_roots()`.
  A bare `kpi://readings` read still works (client omits `?source`). It moves from
  `resources/list` to `resources/templates/list`.
- **Denial behaviour:** tools return `{found: false, error: "roots_denied", ...}`
  (a result, `is_error=False`, not a raised exception). Resources raise
  `ResourceError` → SDK returns a `-32603` protocol error with the message, logs
  at INFO, no traceback (the resource-handler equivalent of "error result rather
  than throwing").
- **SDK layer note:** the template security policy on `kpi://readings{?source}`
  (`reject_path_traversal`, `reject_absolute_paths`) rejects `..`/absolute
  `?source` values *before* our gate — layered, kept. Anything that passes still
  goes through the roots gate.
- **Verified** (`scratchpad/roots_e2e.py`, stdio, two runs):
  - Client declares a root containing the server dir → `verify_kpi_movement`
    `verdict=SIGNIFICANT_UNFAVORABLE`, `assess_monthly_risk` `risk_level=high`,
    both resources return data.
  - Client declares NO roots → all four deny; tools return the error dict,
    resources raise `MCPError(-32603)`; each denial logs `roots_denied`
    `category=no_capability deny_by_default=true requested_path=<bundled file>`.
  - Narrow root (`docs/`) + `source` of `../kpi_readings.sample.json`, an absolute
    path outside it, and `../../../../Windows/win.ini` → all `roots_denied`
    "resolved path is outside every declared root".
  - `test_kpi_analysis.py` 26/26; `compileall` clean; server imports; tool/resource
    discovery: 2 tools / templates `kpi://readings{?source}` + `kpi://readings/{period}`.
- **Not changed (contains a filesystem read, left for review):** none in
  `server.py`. `server_full.py.bak` (`readings_for_period`, `kpi_catalog`) is a
  disused backup with in-memory data — no `open()`. `client_demo.py` is a client,
  and already stale vs the current server surface.

### 2026-09-03 — added `check_live_kpi_dashboard`: the first tool that reads a real running system — session CC-20260903-h4x9

- **System + question:** the project's OWN backend (Express, STORY-003), read over
  HTTP at `GET /api/kpis` — the same endpoint the React dashboard uses. One question:
  *"What KPIs is the live dashboard serving right now — from which uploaded file,
  generated when, and is anything waiting on clarification?"* Optional `kpi` keyword
  narrows to one KPI. This is the only tool that leaves the process; the other two
  still read the bundled `kpi_readings.sample.json`.
- **`server.py` additions:**
  - Imports: `atexit`, `os`, `httpx2` (the HTTP client the installed `mcp` package
    already vendors — no new dependency).
  - **Config from env only (req 4):** `KPI_COPILOT_API_BASE_URL` (required) and
    `KPI_COPILOT_API_TOKEN` (optional → `Authorization: Bearer …`). No host, URL, or
    token literal in source; none is ever logged or placed in a returned error. Logs
    name the boundary as `target="GET /api/kpis"` only. Missing base URL → a
    `not_configured` error result naming the env var.
  - **Bound parameter (req 1):** the request path is the module constant
    `_KPIS_PATH = "/api/kpis"` — never built from input. The model's `kpi` keyword is
    passed as an httpx-encoded `params={"kpi": kpi}` query arg and re-applied as a
    client-side filter on the parsed `kpis`. No f-string ever touches the URL.
  - **Timeout (req 2):** `httpx2.Timeout(connect=3, read=8, write=3, pool=3)` on the
    client and repeated on the request. `except httpx2.TimeoutException` → returns
    `{"ok": false, "error": "timed_out", "error_class": "TimeoutError"}` and logs
    `http_request_failed error_class=TimeoutError timeout_kind=<ConnectTimeout|…>`.
  - **Error result, never throw (req 3):** every failure path — `not_configured`,
    `timed_out`, `unreachable` (`httpx2.RequestError`), `upstream_error` (non-200,
    passes through the backend's own typed `errorClass`/`message`), `bad_response`
    (200 but not JSON), and the catch-all `internal_error` — returns
    `{"ok": false, "error": …, "message": …}`. Nothing propagates out of the tool.
  - **Pooled connection (req 5):** module-level `_get_http_client()` builds one
    process-wide `httpx2.Client` (holds the keep-alive pool), reused by every call;
    `@atexit.register` closes it at shutdown. Each call closes only its own
    `Response`, in a `finally`.
  - **Progress + correlation (req 6):** `_ProgressReporter(ctx, total=3)` — "resolving
    endpoint" → "requesting GET /api/kpis" → "parsing response". `http_request_started`
    / `http_request_completed` (`outcome`, `status_code`, `duration_ms`) bracket the
    call; every line carries the `_InvocationLogger` correlation id.
- **Verified against the real backend** (`scratchpad/probe_live_dashboard.py`, plus an
  inline failure-path probe):
  - Backend started on `PORT=3101`; a 4-row `revenue,expenses` CSV POSTed to
    `/api/upload` so `/api/kpis` served real data (8 KPIs, `filename: sales.csv`).
  - `check_live_kpi_dashboard({})` → `ok: true`, `kpiCount: 8`, full KPI list, HTTP 200
    in ~40 ms; progress `1/3 → 3/3`; logs `tool_started → http_request_started →
    http_request_completed(status_code=200) → dashboard_read(kpi_count=8) →
    tool_completed(outcome=success)`, one correlation id.
  - `{"kpi": "margin"}` → `matched_count=1`, only `business.margin.gross` returned.
  - Base URL unset → `not_configured`, `is_error=False`, no host in output.
  - Dead port `127.0.0.1:59999` → `unreachable`, `error_class=ConnectError`, error
    result (no raise).
  - Non-routable `10.255.255.1` → `timed_out` at the 3 s connect timeout,
    `http_request_failed error_class=TimeoutError timeout_kind=ConnectTimeout`.
  - `test_kpi_analysis.py` 26/26; `compileall` clean; boot check exits 0.
- **Server surface:** now **3 tools** (`verify_kpi_movement`, `assess_monthly_risk`,
  `check_live_kpi_dashboard`) / 2 resources / 1 prompt. New file:
  `scratchpad/probe_live_dashboard.py`. `server.py` grew ~230 lines (now well over the
  500 hard ceiling) — the standing follow-up to extract the resources + prompt into
  their own modules is now overdue and should precede the next feature add.
- **New env vars for whoever runs this tool:** `KPI_COPILOT_API_BASE_URL` (e.g.
  `http://127.0.0.1:3001`), optional `KPI_COPILOT_API_TOKEN`. Add them to the
  `.mcp.json` `env` block if the tool should work inside Claude Code.

### 2026-09-03 — ran the full chain end-to-end from a Messages API harness (no server change)

- **Ask:** run the whole chain once against the real registered server for a real
  owner question, then emit a validated JSON run record via the Messages API
  `output_config` (`format: {type: "json_schema"}`, `additionalProperties: false`,
  all six fields required) and print the server log lines for that run's correlation
  id so the two can be checked against each other.
- **Question used:** *"How are we doing this month — what should I worry about for
  2026-07?"* — routed, as expected, to `assess_monthly_risk`.
- **Harness** (`scratchpad/run_chain.py`, throwaway, not committed; run with
  `uv run --with "anthropic==0.121.0" --directory <this dir> python …`): one stdio
  MCP client wired with all three server-facing callbacks —
  - `sampling_callback` → real `messages.create` on `claude-opus-5` (this is the
    client model `assess_monthly_risk` delegates its judgement to),
  - `list_roots_callback` → declares this package dir as the one root, so the
    server's roots gate lets the bundled-sample read through,
  - `logging_callback` → captures every `notifications/message` line.
  Plus an agent loop (`claude-opus-5`, `tools=[verify_kpi_movement,
  assess_monthly_risk]` from `list_tools()`) and a final `output_config` call for
  the record.
- **Result (one run):** tools in order `assess_monthly_risk`,
  `verify_kpi_movement` (Overdue Invoices), `verify_kpi_movement` (Customer Churn) —
  the model confirmed both significant swings after the briefing. Three correlation
  ids, one per invocation; the record carries the `assess_monthly_risk` id. Sampling
  fired: `briefing_source=client_model`, `degraded=false`,
  `sampling_request_completed outcome=success client_reported_model=claude-opus-5`.
  22 log lines captured total (8 + 7 + 7); `risk_level=high`.
- **SDK notes:** `mcp` 2.1.0 `ClientSession` auto-advertises the sampling and roots
  capabilities purely from a non-default callback being passed (`_build_capabilities`
  keys off `callback is not _default_*`). `CreateMessageResult.stop_reason` wants the
  camelCase MCP spelling (`endTurn` / `maxTokens` / `stopSequence`), so map the
  Anthropic snake_case before returning. `anthropic` 0.121.0 already has
  `output_config` + `JSONOutputFormatParam` on the stable `messages.create` — no beta
  header needed. Windows console is cp1252: force `sys.stdout.reconfigure(encoding=
  "utf-8")` or the em-dash in the answer kills the print.
- **Server surface unchanged:** no edit to `server.py`, sample data, or `.mcp.json`.

### 2026-09-08 — promoted the STDIO entry point to an explicit `main()` — session CC-20260908-a7k4

- **Ask:** turn the bare `if __name__ == "__main__": mcp.run(transport="stdio")`
  one-liner into a real `main()`, so the STDIO transport is configured explicitly
  rather than by default.
- **Why it matters for STDIO specifically:** the transport contract is that stdout
  carries *only* framed JSON-RPC. The one-liner left two gaps: (1) any dependency
  that logs through the stdlib `logging` root (httpx2, asyncio) would default to a
  handler that can write to stdout and corrupt the message stream; (2) Ctrl-C /
  client teardown surfaced a `KeyboardInterrupt` traceback.
- **Change (`server.py`):**
  - added `import logging`, `import sys`;
  - new `def main() -> None:` — `logging.basicConfig(stream=sys.stderr,
    level=logging.INFO)` pins all stdlib logging to stderr, then
    `mcp.run(transport="stdio")` inside a `try/except KeyboardInterrupt: pass`;
  - `if __name__ == "__main__": main()`.
  - The process-wide HTTP pool is still closed by `_close_http_client` (already
    `atexit`-registered) — no change there.
- **Not touched:** transport is still STDIO (per `docs/TRANSPORT_DECISION.md` —
  single local caller, one process, in-memory session state); no Streamable-HTTP
  path added; `.mcp.json` still launches `uv run … python server.py`; the
  `pyproject.toml` `[project.scripts]` entry still points at the placeholder
  `kpi_copilot:main` and was left alone (separate follow-up if `uv run kpi-copilot`
  should share this path).
- **Verification:** `uv run python -m py_compile server.py` OK; `import server`
  OK (`server.main` callable). STDIO handshake smoke test (throwaway
  `scratchpad/smoke_stdio.py`, not committed — `stdio_client` + `ClientSession`):
  `initialize` → `kpi-copilot` / protocol `2025-11-25`; capabilities still include
  `logging` (the `logging/setLevel` handler registration is unaffected);
  `tools/list` → `assess_monthly_risk`, `check_live_kpi_dashboard`,
  `verify_kpi_movement`. stdout parsed as clean framed JSON-RPC by the client.

### 2026-09-08 — live integration run: `check_live_kpi_dashboard` against the STORY-003 backend — session CC-20260908-a7k4

- **System integrated:** the project's own KPI dashboard service — `backend/`
  (Express + TypeScript, STORY-003), `GET /api/kpis`, the same endpoint the React
  dashboard consumes. Not a bundled sample: the tool reads whatever the running
  service last calculated from a real uploaded file.
- **Steps to establish it, end to end:**
  1. Started the backend: `cd backend && PORT=3001 npm run dev` → `{"event":"server_started","port":3001}`.
  2. Seeded real data through the real pipeline: `POST /api/upload` with
     `skill-lab/orders.csv` (12 order rows, `revenue` + `quantity` columns) →
     `202 accepted`, 11 cleaned / 1 flagged (row 7 empty cell), 5 KPIs,
     `status: needs_clarification` (revenue column found, no expenses column).
  3. `GET /api/kpis` now serves those KPIs (total revenue **1582.33**,
     `generatedAt 2026-09-08T20:32:57Z`, `filename orders.csv`).
  4. Configured the MCP client: added an `env` block to the repo-root `.mcp.json`
     — `KPI_COPILOT_API_BASE_URL = http://127.0.0.1:3001`. (Base URL from the
     environment only; the tool already refuses with `not_configured` if unset.)
  5. Ran the MCP server over stdio from a throwaway client
     (`scratchpad/integration_check.py`, not committed) with that env var and a
     `logging_callback`, and called `check_live_kpi_dashboard` three times.
- **Result:**
  - no filter → `ok:true`, `hasData:true`, `filename:"orders.csv"`,
    `generatedAt` matches the backend, 5 KPIs, the 1 clarification carried through.
  - `kpi:"revenue"` → narrowed to 3 keys (`column.revenue.total`,
    `column.revenue.average`, `business.revenue.total`) — filter is applied
    client-side on the parsed result; the request path stays the constant
    `/api/kpis` and `kpi` rides as an httpx-encoded query param.
  - `kpi:"zzz-nope"` → `ok:true`, 0 KPIs, message lists the available keys
    (a miss is not an error).
  - 15 structured MCP log lines (5 per call): `tool_started` →
    `http_request_started` → `http_request_completed`
    (`status_code:200`, `duration_ms` 3–31) → `dashboard_read` → `tool_completed`,
    each stamped with one per-invocation `correlation_id`.
- **Challenges / resolutions:**
  1. **`not_configured` on first call** — no base URL in the client env. Fixed by
     the `.mcp.json` `env` block (persistent) and the client-spawn `env` (test).
  2. **`GET /api/kpis` returned `no_data`** — the store is empty until an upload.
     Resolved by driving a real `POST /api/upload` first, not by pointing the tool
     at a fixture.
  3. **Backup file broke `uv run`** — a `server_full.py.bak` in the package dir
     is harmless, but note the standing follow-up: `server.py` is ~1250 lines,
     well over the 500-line ceiling; the resources/prompt extraction is overdue.
     *(Not changed in this run — flagged only.)*
  4. **Correlation ids do not join across the boundary.** The backend logs a
     `dashboard_access` line per read and the MCP server logs its own
     `http_request_completed`, but the MCP server does not send its
     `correlation_id` as `X-Correlation-ID` on the outbound GET, so the two can
     only be tied together by timestamp. Backend audit lines at `20:33:41.062 /
     .079 / .086` correspond to the three tool calls. **Open improvement:**
     forward the invocation correlation id as `X-Correlation-ID` on the outbound
     request so a single id spans client → MCP server → backend.
- **Verification artifacts:** backend task log shows `dashboard_access`
  `hasData:true kpiCount:5` ×3 for the run; MCP client captured all 15 log lines
  and the three parsed payloads. Backend stopped after the run.
- **Config change committed to the tree:** `.mcp.json` `env` block (file is
  untracked, like all of `mcp-servers/`).

### 2026-09-08 — wrote `docs/UPGRADES.md` (sampling / notifications / roots) — session CC-20260908-a7k4

- **Ask:** document the capabilities layered onto the server after the walking
  skeleton — sampling, progress + log notifications, and roots — with the
  rationale for each and its actual runtime effect.
- **New file:** `docs/UPGRADES.md`. Sections: (1) Sampling — `assess_monthly_risk`
  delegates judgement to the client's model, deterministic maths stays in code,
  server holds no key; degrades to a rule-based brief on any sampling failure.
  (2) Notifications — `_ProgressReporter` (token-gated, real totals, no-op when
  the caller sends no `progressToken`) and `_InvocationLogger` (one correlation id
  per call, stable event names, no secrets; `logging` capability advertised only
  because a `logging/setLevel` handler is registered). (3) Roots —
  `_open_gated_readings` / `_resolve_within_client_roots`: one canonicalise-then-
  contain gate on every read incl. the bundled sample, deny-by-default, denial is
  a returned result not an exception, `roots/list` logged as a timed boundary.
  (4) How the three interoperate. (5) Summary table.
- **Framing:** the doc is explicit that these are not hot-path latency wins —
  the gains are cost (zero server inference), reliability (every capability
  checked, every miss degrades), perceived responsiveness (progress), and
  containment (roots). No code changed in this pass — documentation only.
- **No git commit:** `mcp-servers/` (this file included) is untracked.

### 2026-09-08 — README rewritten to match the real surface; transport confirmed stdio — session CC-20260908-a7k4

- **Transport:** no change. The agreed transport is stdio and the server already
  runs it (`main()` → `mcp.run(transport="stdio")`). The earlier `main()` edit
  made the startup line explicit; it never changed the transport.
- **`README.md` was stale beyond the run section** and was rewritten:
  - title `kpi-lookup` → `kpi-copilot`;
  - primitive table replaced — it listed `search_kpis` (tool) and `kpi://catalog`
    (resource), neither of which exists. Real surface: 3 tools
    (`verify_kpi_movement`, `assess_monthly_risk`, `check_live_kpi_dashboard`),
    2 resource templates (`kpi://readings{?source}`, `kpi://readings/{period}`),
    1 prompt (`kpi_health_check`);
  - dropped the `uv run client_demo.py` block — `client_demo.py` is itself stale
    (calls `search_kpis` / `kpi://catalog`) and would fail. Left the file in place
    but no longer advertised; fix-or-delete is a separate follow-up.
  - run commands kept (`uv run mcp dev server.py`, `uv run server.py`) — both
    verified working with `mcp` 2.1.0; added a stdio/fencing note and pointers to
    `TRANSPORT_DECISION.md` / `UPGRADES.md`.
- **Verification — all three primitive kinds over stdio** (throwaway client,
  `stdio_client` + `ClientSession` with a `list_roots` callback declaring the
  package dir; not committed):
  - `initialize` → `kpi-copilot`, protocol `2025-11-25`.
  - **tool** `verify_kpi_movement {kpi:"churn", period:"2026-07"}` → `found:true`,
    `Customer Churn Rate`, `SIGNIFICANT_UNFAVORABLE`, `percent_change 37.1`.
  - **resource** `kpi://readings/2026-07` → 7 rows, 7 distinct KPIs (both
    resources are templates, so `resources/list` is empty and
    `resources/templates/list` carries both — expected).
  - **prompt** `kpi_health_check {kpi:"churn", period:"2026-07"}` → rendered a
    3576-char instruction.
- **Inspector note:** `uv run mcp dev server.py` launches the browser Inspector;
  it could not be driven headless here, so the stdio client above stands in for
  it — it exercises the same `tools/call`, `resources/read`, `prompts/get` paths.

### 2026-09-08 — external-boundary audit + two tighter fences — session CC-20260908-a7k4

- **Audited every place `server.py` touches the filesystem / network / env /
  subprocess.** Findings: no writes, no `subprocess`/`os.system`/`eval`, no
  directory listing — the server can only open one named file at a time and make
  one fixed HTTP GET. Two real gaps:
  1. **`source` path override (`verify_kpi_movement`, `kpi://readings?source=`)**
     was fenced only to *the client's declared roots*. A client that declares a
     broad root (Claude Code declares the whole workspace) let `source` read **any
     readings-shaped JSON anywhere under that root** — e.g. `../../<repo>/x.json`.
     Demonstrated: with the project root declared, `source=../../_fence_demo_readings.json`
     returned `current_value: 999999` from a file outside `mcp-servers/kpi-copilot/`.
  2. **`KPI_COPILOT_API_BASE_URL`** was used with no scheme check — `file://`,
     `ftp://`, or a bare string would be handed to the HTTP client.
- **Fix 1 — server-owned filesystem floor.** New `_ALLOWED_DATA_ROOTS =
  (_PACKAGE_DIR,)`. `_resolve_within_client_roots` now, *before* asking the client
  for roots, requires `real_target.is_relative_to()` one of those dirs, else
  `RootsDenied(category="outside_server_dir")`. The client-roots check and
  deny-by-default (no roots → nothing, bundled sample included) are unchanged and
  still run after. Denial messages in both tools + the resource wrapper updated to
  "inside the server's own data directory AND inside a root the client has
  declared". If real external data lands later, add it to `_ALLOWED_DATA_ROOTS`
  explicitly — do not widen the check.
- **Fix 2 — base-URL scheme fence.** `check_live_kpi_dashboard` now `urlparse`s
  `KPI_COPILOT_API_BASE_URL`; scheme not in `{http, https}` or no host →
  `{"ok": false, "error": "bad_base_url", …}` (logs the scheme only, never the
  URL). Host is still operator-chosen and not restricted further — env is trusted
  config, not caller input.
- **Left as-is (already tight):** the fixed request path `/api/kpis` (model input
  never concatenated in — `kpi` rides as an encoded query param, `max_length=100`);
  `roots/list` and `create_message` to the client over the pipe (fail-closed /
  capability-checked); the two env reads (never logged).
- **Verification (throwaway stdio clients, not committed):**
  - before: broad root + `source` outside the pkg dir → read succeeded,
    `current_value: 999999`.
  - after, same call → `roots_denied`, "path resolves outside the server's data
    directory (…/mcp-servers/kpi-copilot)".
  - after, normal bundled read with root = the server folder → still works
    (`Customer Churn Rate`, `SIGNIFICANT_UNFAVORABLE`, +37.1%).
  - after, `KPI_COPILOT_API_BASE_URL=file:///etc/passwd` → `bad_base_url`
    ("got scheme 'file'").
  - `uv run python -m py_compile server.py` OK; `kpi_analysis` unit tests 26/26
    (unchanged module, sanity only). Planted `_fence_demo_readings.json` deleted.
- **No git commit:** `mcp-servers/` is untracked.

### 2026-09-08 — new adapter: `send_kpi_alert_to_slack` (REQ-005 Slack leg) — session CC-20260908-a7k4

- **Integration chosen from `.colaberry/plan.json`.** `derived.systems` =
  Excel, Google Sheets, Slack, Gmail, Outlook, QuickBooks, Dropbox, Google Drive
  (REQ-006). Picked **Slack** — clearest value (REQ-005 needs alerts to reach
  owners "via email and Slack"; STORY-004 already built detection + dedupe +
  dry-run transports, so only the send was missing) and lowest setup of any
  system on that list: one Incoming Webhook URL in an env var, no OAuth, no token
  refresh, no scopes. Google*/QuickBooks/Dropbox/Outlook all need an OAuth app +
  developer account (and would be a governed external-dependency decision);
  "Excel" is a file format, not a running system.
- **Tool `send_kpi_alert_to_slack(summary, details=[], severity="warning")`** in
  `server.py`, before `main()`. New imports `collections`, `hashlib`, `Literal`.
  - **Inputs declared + validated at the schema boundary:** `summary` str 1–300;
    `details` list ≤20 of str 1–200 (nested `Annotated`); `severity`
    `Literal["info","warning","critical"]`. Plus in-body guards, all *before* any
    network work: assembled-text ≤ `_SLACK_TEXT_MAX` (4000), `KPI_COPILOT_SLACK_WEBHOOK_URL`
    present, and URL must be `https://hooks.slack.com/...` (scheme + exact host).
  - **Explicit timeout:** dedicated `_SLACK_TIMEOUT = httpx2.Timeout(connect=3,
    read=5, write=3, pool=3)` passed on the `.post()`; reuses the pooled
    `_get_http_client()`.
  - **Never crashes:** `httpx2.TimeoutException` → `timed_out`,
    `httpx2.RequestError` → `unreachable`, non-200 / body≠"ok" → `rejected`
    (carries `status_code` + short `slack_response`), catch-all → `internal_error`.
    Every branch returns `{"ok": false, "error": ...}`.
  - **Idempotent:** bounded `_SLACK_SENT` OrderedDict (sha256 of
    severity+summary+details, cap 256) — an identical alert repeated in-process
    returns `{"ok": true, "deduped": true}` and is not re-posted. Recorded only on
    a confirmed 200/ok.
  - Config env-only, never logged (logs the scheme/host on `bad_webhook_url`, not
    the URL).
- **Verification (throwaway clients, not committed):**
  - `not_configured` (no env) ✓ · `bad_webhook_url` (wrong host) ✓ ·
    schema rejects empty `summary` ✓ · `invalid_input` (4085-char body) ✓
  - `rejected` — real POST to `hooks.slack.com` with a fake path → HTTP 404
    `no_team`, "alert was NOT posted" ✓
  - `unreachable` — 127.0.0.1:1 refused → `unreachable` ✓
  - `timed_out` — 10.255.255.1 blackhole → connect timeout ~3s → `timed_out`,
    `error_class: TimeoutError` ✓ (both via monkeypatching only `_SLACK_HOST` in
    the test; `server.py` untouched)
  - Regression: `py_compile` OK; `tools/list` now 4
    (`+send_kpi_alert_to_slack`); `verify_kpi_movement`, `kpi://readings/2026-07`,
    `kpi_health_check` all still work.
- **Setup for real use:** create a Slack Incoming Webhook, set
  `KPI_COPILOT_SLACK_WEBHOOK_URL` in the environment or the `.mcp.json` `env`
  block. Not added to `.mcp.json` here — a webhook URL is a credential.
- **No git commit:** `mcp-servers/` is untracked.

### 2026-09-08 — cross-call state audit + fixed the silent-wrong-answer one — session CC-20260908-a7k4

- **Inventory of everything remembered between calls** (grep for `global`,
  module-level mutable assignment, `lru_cache`, `.append`/`.write`/`open(...,'a')`):
  1. `_HTTP_CLIENT` — one pooled `httpx2.Client` (max 4 conns), lazy-created,
     `atexit`-closed.
  2. `_SLACK_SENT` — in-memory `OrderedDict` (cap 256) of sent Slack alert keys.
  - **No file is appended to.** Logs go to stderr + the MCP pipe. No writes
     anywhere. Set-once config (`warnings` filter, `logging/setLevel` handler,
     `logging.basicConfig`) is not per-call state.
- **Concurrency / restart per item:**
  - `_HTTP_CLIENT`: concurrent-safe (pool; lazy-create has no `await` in the
    critical section so it can't double-build on one loop); >4 concurrent → a
    `timed_out`/`unreachable` **error**, never a wrong result. Restart → fresh
    client; GET caller is read-only so re-run is safe.
  - `_SLACK_SENT`: check-then-post is not atomic → a true simultaneous duplicate
    can post **twice** (visible dup, not a miss). Restart → cache empty → a
    just-sent alert can re-post once on retry (visible dup).
- **The one that causes a SILENT wrong answer:** `_SLACK_SENT`, because its key
  was `sha256(severity+summary+details)` — the *wording*, not the *event*. A real
  new alert that read identically to one sent earlier in the process's life
  returned `{"ok": true, "deduped": true}` and was **never delivered**. No error;
  nobody notices a missing Slack message.
- **Fix (`server.py`):**
  - `_slack_dedup_key(dedup_key, summary, details, severity)` — `"k:"`+hash of an
    explicit caller key, else `"w:"`+hash of the wording.
  - New optional tool input `dedup_key` (≤200 chars): identifies the event; that
    event is posted at most once per process, however far apart the calls.
  - New `_SLACK_DEDUP_WINDOW_S = 600`. A `"w:"` hit only counts as a duplicate
    within 10 min — beyond that a same-wording alert is treated as a genuine
    recurrence and **sent**. `"k:"` hits dedupe for the whole process regardless
    of time.
  - `move_to_end` on record so the LRU cap evicts truly-oldest.
- **Verification (controlled-clock in-process test, stub 200/"ok" client; not
  committed):** wording repeat at +2 min → suppressed; same wording at +69 min →
  **sent**; explicit `dedup_key` repeated days later → suppressed; new
  `dedup_key`, same wording → sent. `py_compile` OK; `tools/list` still 4;
  `verify_kpi_movement` / resource / prompt unaffected.
- **The other assumptions** (`_HTTP_CLIENT`, `_SLACK_SENT` concurrency/restart
  behaviour, the 10-min window, cap-256 eviction, single-caller model) are now
  written up in `README.md` → "What this server assumes".
- **No git commit:** `mcp-servers/` is untracked.

### 2026-09-08 — end-to-end run: REQ-013 gate -> Slack alert; found a 429 gap — session CC-20260908-a7k4

- **Task run** (throwaway client, not committed): the STORY-004 flow —
  "churn jumped Jun->Jul 2026; verify it's significant (REQ-013), then alert
  Slack (REQ-005)". Chain: `verify_kpi_movement` -> decide -> `send_kpi_alert_to_slack`.
- **Real-network run** (`KPI_COPILOT_SLACK_WEBHOOK_URL` = a well-formed but fake
  `hooks.slack.com` path):
  - init: ~1140 ms (mostly `uv`/Python spawn).
  - `verify_kpi_movement(churn, 2026-07)`: 12 ms, no wait — `Customer Churn Rate`
    6.2 -> 8.5, +37.1%, threshold 15%, `SIGNIFICANT_UNFAVORABLE`.
  - `send_kpi_alert_to_slack(...)`: **368 ms — the wait** — one real HTTPS POST to
    `hooks.slack.com`; Slack returned `404 no_team`; tool returned
    `{"ok": false, "error": "rejected", ...}`; `_SLACK_SENT` not updated.
  - identical re-call: 66 ms (pooled connection reused), same `rejected`.
- **Stubbed-success run** (HTTP client faked to `200 "ok"`, everything else real):
  STEP 2 -> `{"ok": true, "deduped": false, "lines_posted": 3}`, POST body
  `:rotating_light: *KPI alert - critical*\nCustomer Churn Rate rose +37.1%...`;
  STEP 3 same `dedup_key` -> `{"ok": true, "deduped": true}`, stub saw **1** POST.
  Idempotency fix holds on the happy path.
- **Gap found — not fixed this pass:** the non-200 branch (`server.py` ~1525)
  lumps `429 Too Many Requests` in with `404 revoked` as `error: "rejected"`,
  message "webhook may be revoked or malformed", **no `Retry-After`, no retry**.
  Slack incoming webhooks rate-limit ~1 msg/s; during a real multi-KPI incident
  alerts 2..n would come back "rejected" and be dropped, and the caller would
  likely treat the webhook as dead. This is the thing not to trust in front of a
  customer. Fix later: branch 429 -> `error: "rate_limited"` + surface
  `retry_after`, and/or one bounded backoff retry.
- **No git commit:** `mcp-servers/` is untracked.
