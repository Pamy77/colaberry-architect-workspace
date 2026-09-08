# KPI Copilot MCP Server — Upgrade Record

What was added to `server.py` beyond the first single-tool version, why each
change was made, and what it actually buys at runtime.

- **Server:** `mcp-servers/kpi-copilot/server.py` (server name `kpi-copilot`)
- **Protocol version negotiated:** `2025-11-25`
- **Transport:** STDIO (see `TRANSPORT_DECISION.md`)
- **Blow-by-blow history:** `BUILD_NOTES.md` running log
- **Scope of this doc:** the three MCP capabilities layered on after the walking
  skeleton — **sampling**, **notifications** (progress + structured logs), and
  **roots** — plus how they interact.

A note on "performance": none of these are latency optimisations to the hot path.
The gains are in **cost**, **reliability**, **perceived responsiveness**, and
**containment**. Where a change has no measurable runtime cost, that is stated
plainly rather than dressed up.

---

## 1. Sampling — delegate judgement to the client's model

### What changed

- Added the tool **`assess_monthly_risk`**, which produces a prioritised,
  plain-English monthly read on the KPIs.
- The tool splits cleanly into two halves:
  - **Deterministic half (server-owned):** load the readings, run `kpi_analysis`
    over them — month-over-month change, target status, trend — and build a text
    digest. No model involved.
  - **Judgement half (client-owned):** the digest is sent to the *calling
    client's* model via an MCP **`sampling/createMessage`** request:
    ```python
    completion = await ctx.request_context.session.create_message(
        messages=[types.SamplingMessage(
            role="user",
            content=types.TextContent(type="text", text=digest_text),
        )],
        system_prompt=_RISK_SYSTEM_PROMPT,   # "pick the 2–4 KPIs that matter, worst first…"
        max_tokens=_RISK_MAX_TOKENS,          # 600
    )
    ```
- The server **names no model and holds no API key.** Which model runs, and who
  pays for it, belongs entirely to the connected client. The result records
  `completion.model` as `client_reported_model` — the client's choice, echoed
  back, never set here.

### Rationale

- **The data work is deterministic and must stay that way.** CLAUDE.md's core
  principle: production systems are deterministic; the LLM reasons, it does not
  compute. The MoM maths, target gaps and trend calls are done in code and are
  identical on every run. Only the *phrasing and prioritisation* — a genuinely
  judgement-shaped task — is handed to a model.
- **A server should not ship credentials or a model choice.** Putting an API key
  in the server would make it a secret-bearing service, tie it to one provider,
  and break the "config separated from code" rule. Sampling inverts that: the
  client already has a model and a budget, so the server borrows them.
- **The host stays in control.** Under MCP the client can inspect, edit, or
  refuse a sampling request. The server cannot silently spend the user's tokens.

### Failure behaviour (why it never blocks)

- Before calling, the tool checks the client actually advertised the capability:
  ```python
  if not ctx.request_context.session.check_client_capability(
      types.ClientCapabilities(sampling=types.SamplingCapability())
  ):
      return await _degraded_return(base_result, summary, "client does not support MCP sampling", …)
  ```
- The `create_message` call is wrapped: a refusal, timeout, transport error, or
  empty/non-text completion all fall through to `_degraded_return`, which returns
  **the full deterministic digest plus a rule-based briefing**
  (`render_rule_based_brief`), tagged `briefing_source: "rule_based_fallback"`,
  `degraded: true`, `degraded_reason: <why>`.
- On success the payload carries `briefing_source: "client_model"`,
  `degraded: false`, and `sampling: {client_reported_model, stop_reason, duration_ms}`.

### Effect on performance and cost

- **Server-side inference cost: zero.** The server runs no model. The token spend
  and the model latency live on the client, which is where the budget is.
- **The tool always returns something useful and fast in the common-error case.**
  If the model step is slow or unavailable, the deterministic digest + rule-based
  brief are produced with no network round trip at all.
- **One SDK gotcha handled:** `CreateMessageResult.stop_reason` expects the
  camelCase MCP spelling (`endTurn` / `maxTokens` / `stopSequence`), so the
  Anthropic snake_case is mapped before returning — otherwise clients that
  validate the result strictly would reject it.

---

## 2. Notifications — progress and structured logs

Two separate MCP channels were added. Both are server → client, both ride the
STDIO pipe for free, and both were later unified into one helper each so every
tool uses the same implementation.

### 2a. Progress notifications (`notifications/progress`)

**What changed**

- Added `_ProgressReporter`, one instance per tool invocation, used by every tool
  that can run longer than a second or two.
- It is **token-gated**: the caller's `progressToken` rides on the inbound
  request's `_meta`. The reporter reads it once. If the caller sent none, every
  method is a **no-op** — nothing is emitted and the tool behaves exactly as it
  did before progress existed.
- It reports a **running count**, and only claims a fraction when the total is
  genuinely known up front:
  ```python
  async def step(self, message: str, *, advance: float = 1.0) -> None:
      self._count += advance
      if self._token is None:
          return
      if self._total is not None:
          await self._ctx.report_progress(self._count, self._total, message)
      else:
          await self._ctx.report_progress(self._count, None, f"{message} — total not known up front")
  ```
- Totals are real: `verify_kpi_movement` uses `total = len(known_kpis)` (one step
  per KPI during name resolution); `assess_monthly_risk` uses `total = 4` (load →
  score → model briefing → assemble); `check_live_kpi_dashboard` uses `total = 3`.

**Rationale**

- A model-sampling round trip or a slow upstream can take many seconds. Without
  progress the host shows a frozen spinner and the user cannot tell a slow call
  from a hung one.
- Token gating means the feature is **strictly opt-in** — a client that does not
  ask for progress pays nothing, and older behaviour is byte-for-byte preserved.
- Refusing to invent a percentage keeps the signal honest: a progress bar driven
  by this server is never fake.

**Effect on performance**

- **Perceived responsiveness only.** No change to how fast a tool computes.
- **Overhead when unused: none** (the `progressToken is None` early return).
- **Overhead when used: negligible** — a handful of small notification frames per
  call on an already-open pipe.

### 2b. Structured log notifications (`notifications/message`)

**What changed**

- Added `_InvocationLogger`, one per tool call. It mints a single
  **correlation id** and stamps it — with the service and tool names — onto every
  line:
  ```python
  async def event(self, level: str, event: str, /, **fields: object) -> None:
      await self._ctx.log(level, {"event": event, **self._base, **fields}, logger_name=_SERVICE)
  ```
- Payloads are always `{event, service, tool, correlation_id, …fields}` — a
  **stable event name** plus identifiers, counts and durations. Never a formatted
  sentence, and never a key, token, connection string or raw record.
- External boundaries are logged as timed pairs: `data_load_started` /
  `data_load_completed` (+ `row_count`, `duration_ms`), `http_request_started` /
  `http_request_completed` (+ `status_code`, `duration_ms`),
  `roots_list_started` / `roots_list_completed`.
- **Capability wiring (the non-obvious part):** `MCPServer` only advertises the
  `logging` capability at `initialize` if a `logging/setLevel` handler exists.
  A minimal handler is registered on the low-level server:
  ```python
  mcp._lowlevel_server.add_request_handler(
      "logging/setLevel", types.SetLevelRequestParams, _accept_log_level
  )
  ```
  Without this, the client silently drops every log message — nothing errors, the
  code just looks broken.
- `warnings.filterwarnings("ignore", MCPDeprecationWarning)` — the SDK marks
  protocol logging deprecated for a *future* handshake (2026-07-28); the version
  this server negotiates (2025-11-25) still delivers it on every level, so the
  per-call warning is suppressed on purpose.

**Rationale**

- CLAUDE.md's Observability Framework: structured JSON events, one correlation id
  per unit of work, every external call logged with duration and outcome, a
  stable `error_class` on failure. This is that contract, expressed over the MCP
  logging channel instead of stdout.
- Logging over `notifications/message` (not `print`) is also what keeps the STDIO
  transport intact — stdout stays pure framed JSON-RPC.

**Effect on performance**

- **No meaningful runtime cost.** Building a small dict and handing it to the SDK
  once per phase.
- **Large diagnostic payoff:** a slow or failed call can be reconstructed
  after the fact from one correlation id — which phase ran long
  (`duration_ms` per boundary), where it stopped, and with what `error_class` —
  without attaching a debugger or adding print statements.

---

## 3. Roots — one gate on every filesystem read

### What changed

- Every path the server turns into an open file now passes through a single choke
  point, `_open_gated_readings` → `_resolve_within_client_roots`. Nothing in the
  module calls `open()` / `_load_readings()` on an ungated path — **including the
  bundled sample file**.
- The check is order-sensitive and deliberately **not** a string prefix test:
  1. **Canonicalise first.** `Path.resolve()` collapses every `..` segment and
     follows every symlink to its real target.
  2. **Contain second.** `real_target.is_relative_to(root_real)` — component-wise,
     against a root the client declared via `roots/list`.
  ```python
  real_target = candidate.resolve()                 # FIRST
  …
  for root in declared:
      if real_target.is_relative_to(_root_uri_to_path(root.uri).resolve()):  # SECOND
          return real_target
  raise RootsDenied(requested, str(real_target), "resolved path is outside every declared root", "outside_roots")
  ```
- **Deny by default.** A client that declares no `roots` capability, or an empty
  roots list, or whose `roots/list` call fails, gets **no filesystem access at
  all** — each is its own `RootsDenied` category
  (`no_capability` / `empty_list` / `list_failed`).
- Denial is a **returned error result** (`{found: false, error: "roots_denied", …}`
  with a message explaining what to declare), never a raised exception that could
  drop the connection.
- The outbound `roots/list` call is instrumented as a timed boundary
  (`roots_list_started` / `roots_list_completed` with `duration_ms` and
  `root_count`), the same shape as every other external call.

### Rationale

- **Security is woven in, not bolted on** (CLAUDE.md Security Enforcement Layer).
  Untrusted input — here, an optional `source` path a tool caller can supply —
  must be validated against a boundary before use.
- A raw `resolved.startswith(root)` check is unsafe three concrete ways, each a
  real bypass: `<root>/../../etc/passwd` has the text prefix but resolves outside;
  a symlink under `<root>` pointing at `/etc/shadow` has the prefix too; a sibling
  directory like `<root>-evil` shares the prefix string. Canonicalise-then-contain
  closes all three.
- Routing the **bundled sample** through the same gate means there is no
  privileged path — a client that declared no roots is refused consistently,
  rather than the server quietly reading its own directory.

### Effect on performance

- **Containment, not speed.** The cost per read is one `Path.resolve()` plus one
  `roots/list` round trip to the client.
- `roots/list` is a client round trip, so it is **logged as a timed boundary** —
  if a client's back-channel is slow, that shows up as `roots_list_completed`
  `duration_ms` rather than as an unexplained stall inside the tool.
- Failure is cheap and safe: a denied call returns immediately with a clear
  message; it never retries, never hangs, never partially reads.

---

## 4. How the three fit together

- **One correlation id spans all of it.** `_InvocationLogger` mints the id at the
  top of a tool call; the roots check (`roots_list_started/completed`), the data
  load, the sampling request, and the progress steps all carry it. A single
  invocation is followable end to end.
- **Every capability is checked before use, and every miss degrades instead of
  failing.** No sampling capability → rule-based briefing. No roots capability →
  clear `roots_denied` result. No `progressToken` → silent, unchanged behaviour.
  The server never assumes a client feature is present.
- **Nothing new touches stdout.** Sampling is a request/response on the pipe;
  progress and logs are notifications on the pipe; roots is a request to the
  client. The STDIO framing invariant holds across all three.
- **The division of labour is consistent:** the server owns deterministic
  computation, path containment, and structured audit; the client owns the model,
  the token budget, and the declaration of which roots are in scope.

---

## 5. Summary

| Upgrade | MCP mechanism | Primary benefit | Runtime cost |
|---|---|---|---|
| **Sampling** (`assess_monthly_risk`) | `sampling/createMessage` | Judgement without the server holding a key or model; deterministic maths stays in code | Zero server inference; graceful rule-based fallback |
| **Progress** (`_ProgressReporter`) | `notifications/progress` | Long calls stop looking hung; opt-in | None when unused; negligible when used |
| **Structured logs** (`_InvocationLogger`) | `notifications/message` | One correlation id per call; every boundary timed; post-hoc diagnosis | None meaningful |
| **Roots** (`_open_gated_readings`) | `roots/list` + canonicalise-then-contain | One safe gate on every read; deny by default | One `resolve()` + one client round trip per read, itself timed |
