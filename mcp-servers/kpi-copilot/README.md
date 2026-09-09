# kpi-copilot

## Watch it run

**▶ [Watch the walkthrough](../../artifacts/week-06/kpi-copilot-slack-alert-walkthrough.mp4)** — the
server handling a real task end to end: `verify_kpi_movement` confirms a
month-over-month churn spike is past the alert threshold (REQ-013), then
`send_kpi_alert_to_slack` posts it to the team channel (REQ-005). Opens in
GitHub's video player.

An MCP server for the Small Business KPI Copilot. It works over a bundled sample of
KPI readings (revenue, churn, CSAT, cash on hand, gross margin, feature adoption,
overdue invoices); one tool reads the project's own live dashboard backend and one
posts alerts to Slack.

| Kind | Name | Purpose |
|---|---|---|
| tool | `verify_kpi_movement` | Model-invoked. Recomputes one KPI's month-over-month change from the readings and decides whether the swing clears the alert threshold. |
| tool | `assess_monthly_risk` | Model-invoked. Scores every KPI for a month, then asks the calling client's own model (MCP sampling) to write a short plain-English briefing. Falls back to a rule-based briefing if the client can't sample. |
| tool | `check_live_kpi_dashboard` | Model-invoked. Reads what the live dashboard is serving right now via the project backend's `GET /api/kpis`. Needs `KPI_COPILOT_API_BASE_URL` set. |
| tool | `send_kpi_alert_to_slack` | Model-invoked. Posts a KPI alert to a Slack channel via an Incoming Webhook (REQ-005). Needs `KPI_COPILOT_SLACK_WEBHOOK_URL` set. Pass `dedup_key` to identify the event so it is posted at most once. |
| resource | `kpi://readings{?source}` | Every stored reading across all periods, as JSON. Optional `?source=<path>` reads an alternative file, fenced to the client's declared roots. |
| resource | `kpi://readings/{period}` | Every reading for one month, e.g. `kpi://readings/2026-07`. One handler serves every period. |
| prompt | `kpi_health_check` | User-invoked. Args `kpi` (required), `period` (default `latest`). Renders an instruction that drives a single-KPI health assessment through `verify_kpi_movement`. |

Rule of thumb: **tools** are for the model to call mid-reasoning; **resources** are
for the host/user to pull into context deliberately; the **prompt** is a saved
instruction the user triggers (e.g. as a slash command) that then makes the model
use a tool.

## Run

Transport is **stdio** — the MCP client launches `server.py` as a child process and
talks to it over stdin/stdout. See `docs/TRANSPORT_DECISION.md` for why, and
`docs/UPGRADES.md` for the sampling / notifications / roots capabilities.

Interactive testing in the MCP Inspector:

```
uv run mcp dev server.py
```

Run the server standalone over stdio (no Inspector — this is also how a real MCP
client starts it):

```
uv run server.py
```

Filesystem reads — the two resources, and `verify_kpi_movement`'s optional
`source` argument — are fenced: the resolved path must sit inside this server's
own directory **and** inside a filesystem root the connecting client declares, or
the read is denied. `check_live_kpi_dashboard` needs `KPI_COPILOT_API_BASE_URL`
and `send_kpi_alert_to_slack` needs `KPI_COPILOT_SLACK_WEBHOOK_URL` in the
environment; the registered setup is in the repo-root `.mcp.json` (the Slack
webhook is a credential and is not committed there).

## What this server assumes

This server keeps a small amount of state in memory between tool calls. None of it
is written to disk, and all of it is lost on restart. That is deliberate for a
single-user stdio server, but it means the following assumptions hold:

- **One server process serves one client.** State is not isolated per session
  because there is only ever one session. If this server is ever reached by more
  than one caller at once (which stdio does not do, but Streamable HTTP would),
  these assumptions break and the state below must move to a per-session or shared
  store.
- **The pooled HTTP client (`_HTTP_CLIENT`)** — one `httpx2.Client` with a
  keep-alive pool (max 4 connections), created on first use, closed at process
  exit.
  - *Two calls at once:* safe. Each borrows its own connection; a 5th concurrent
    call waits up to 3s then returns a `timed_out` / `unreachable` error — it
    never blocks forever and never returns a wrong result.
  - *Restart mid-call:* the in-flight request is abandoned. `check_live_kpi_dashboard`
    is a read-only GET, so re-running is safe. A `send_kpi_alert_to_slack` POST
    interrupted after Slack accepted it but before it was recorded may be
    re-posted on retry (see below).
- **The Slack dedupe cache (`_SLACK_SENT`)** — an in-memory map of the last 256
  alert keys to their send time, used so the same alert is not posted twice.
  - *Two identical calls at once:* the check and the record are not atomic, so a
    true simultaneous duplicate can still post twice. The result is a visible
    duplicate message, never a missing one.
  - *Restart:* the cache is empty on start, so an alert sent just before a restart
    can be re-sent once on retry. Pass a stable `dedup_key` and this is still a
    duplicate *within* a process; across a restart it is not caught.
  - *Cache full (>256 distinct alerts):* the oldest key is evicted; re-sending a
    long-ago alert would post it again.
- **`_SLACK_DEDUP_WINDOW_S` (10 minutes)** — without a `dedup_key`, a same-wording
  alert is treated as a duplicate only within this window. Beyond it, an alert
  that reads identically to an earlier one is assumed to be a real recurrence and
  is sent. Pass `dedup_key` when you want exact, time-independent dedupe.

## Status

Working server: 4 tools, 2 resource templates, 1 prompt. Sample data is bundled;
`check_live_kpi_dashboard` and `send_kpi_alert_to_slack` touch real running
systems. No persistence — see "What this server assumes".
