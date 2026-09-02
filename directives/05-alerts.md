# Directive 05: Alerts & Insights (STORY-004)

## Goal

When a KPI moves significantly between one upload and the next, tell the
business owner about it over email (and Slack), with the actual numbers in the
message; when nothing moved enough, stay quiet; and record every alert and its
full contents so an audit can see exactly what went out.

Satisfies REQ-005 (FUNC, must) — "send alerts and actionable insights to users
via email and Slack" — and the project guardrail "verify significant drops or
increases in KPIs before sending alerts" (first implementation; STORY-012
hardens it).

## Inputs

- `backend/src/services/latestKpiStore.ts` — now keeps the previous KPI
  calculation as well as the latest (`getPrevious()` / `getLatest()`).
- `backend/src/services/alertDetectionService.ts` — `detectKpiAlerts(previous, current, opts?)`.
- `backend/src/services/notificationService.ts` — `buildAlertContent`,
  `deriveAlertKey`, `sendKpiAlert`.
- `backend/src/services/emailTransport.ts` / `slackTransport.ts` — channel adapters.
- `POST /api/alerts/run` — the trigger endpoint.
- Env: `ALERT_THRESHOLD_PCT` (default 15), `ALERT_DEDUP_CACHE_SIZE` (default 256),
  `MANDRILL_API_KEY` / `SLACK_WEBHOOK_URL` (see "Delivery" below).

## What "significant" means

For each KPI key present in both the previous and current calculation:

```
absoluteChange = current.value - previous.value
percentChange  = absoluteChange / |previous.value| * 100    (null when previous is 0)
significant    = |percentChange| >= ALERT_THRESHOLD_PCT      (any move from 0 counts)
```

Unchanged KPIs, and KPIs that are new or have disappeared (no baseline), are not
alerted on. This mirrors the `verify_kpi_movement` MCP tool's model — that tool
is Claude's; `alertDetectionService` is the app's deterministic equivalent.
STORY-012 layers a stronger check on top (favorability, data-artifact
detection); `sendKpiAlert` is where that step will slot in, before delivery.

## Outputs

- `POST /api/alerts/run` response (`AlertRunResponseSchema`), `status`:
  - `no_data` — no calculation exists yet
  - `no_baseline` — only one calculation, nothing to compare
  - `no_changes` — a comparison ran, nothing cleared the threshold (**no alert
    sent** — STORY-004 acceptance #2)
  - `already_sent` — this exact set of changes was already alerted on
  - `sent` — at least one channel delivered (STORY-004 acceptance #1)
  - `send_failed` — significant changes, but every channel failed (**HTTP 502**)
  - body carries `alertId`, `thresholdPct`, the `alerts[]` (full `KpiAlert`
    objects), and per-channel `channels[]`.
- `X-Correlation-ID` response header on every call.
- Structured audit lines (STORY-004 acceptance #3 — "logs all alerts sent and
  their contents"):
  - `alert_check` — `sent: false` with `reason` `no_significant_changes` or
    `duplicate`.
  - `alert_delivery` — one per channel attempt (`outcome: simulated | sent | failed`),
    carries `subject` + `bodyPreview`.
  - `alert_sent` — the authoritative record: `outcome`, `correlation_id`,
    `alertId`, `subject`, and the **full `body`**, plus per-channel outcomes.
  - Per-channel sends also emit `processing_step` lines (via
    `processingAudit.runStep`) with the timeout/retry lifecycle.

## Idempotency

`deriveAlertKey(alerts, generatedAt)` is a sha256 over the current calculation's
`generatedAt` and the sorted list of `key:prev->cur` pairs. A bounded in-memory
set remembers keys that were sent. Rules:

- Same changes + same calculation ⇒ sent once. Re-running `POST /api/alerts/run`
  returns `already_sent` and delivers nothing.
- A key is remembered **only if at least one channel delivered**. If every
  channel failed, the key is not remembered, so a later retry can try again.
- Partial success (one channel delivered, another failed) counts as sent and is
  remembered — the failed channel is **not** retried on a later run (documented
  limitation; per-channel retry-later is a harden concern).
- In-memory and per-process; a restart clears it. Durable dedup is STORY-014.

## Delivery (walking-skeleton shortcut)

Both transports are **dry-run only** right now: they log the full alert content
(`alert_delivery`, `outcome: simulated`) and return success. This exercises
detection, idempotency, and audit end to end without credentials and without
sending anything.

If `MANDRILL_API_KEY` / `SLACK_WEBHOOK_URL` is set, a `warn` line
(`alert_transport_config`) says the real adapter is not built yet and delivery
still falls back to dry-run — no untested HTTP path ships, nothing is silently
dropped.

**Harden pass (STORY-004 follow-up):** real adapters behind the env gate —
Mandrill `POST /api/1.0/messages/send.json`, Slack incoming webhook — each with
an explicit timeout + capped retry (reuse `processingAudit.runStep`), the
secret read from env and redacted in every log line. Application-level dedup for
Mandrill sends per CLAUDE.md's Idempotency table (`recipient, subject,
business_event_id`).

## Trigger

`POST /api/alerts/run` is called by hand, by a scheduler, or after an upload.
It is **not** wired into `uploadRoute.ts` — kept separate so STORY-004 does not
touch the upload path again and so "no double-send on upload retry" is trivially
true. Auto-firing on upload is an option for the harden pass.

## Edge cases

- No calculation / one calculation → `no_data` / `no_baseline`, nothing sent.
- Change below threshold → `no_changes`, nothing sent.
- Re-run for the same change → `already_sent`.
- Re-uploading the same file → `setLatest` collapses previous == latest → no
  change detected for that pair (intended). Re-uploading an *older* file before
  alerts ran can drop an un-checked comparison (documented in
  `latestKpiStore.ts`).
- Zero baseline (`previous.value === 0`) → any non-zero move is significant,
  `percentChange` reported as `null`, copy says "rose/fell from zero".
- Every channel fails → HTTP 502 `send_failed`, key not remembered.

## Failure modes handled vs not handled

Handled: email delivery failure and Slack integration error (per-channel
`runStep` timeout + capped retry; failure recorded per channel; 502 when all
fail; key not remembered so a retry can re-send), alert content incorrect
(`buildAlertContent` is pure and unit-tested; content is built from the typed
`KpiAlert`, not free text), double-send (idempotency key + dedup set).

Not handled (documented, deferred): real email/Slack delivery (dry-run only
until the harden pass); per-channel retry-later after a partial success;
durable/cross-process dedup and alert history (STORY-014); deeper "is this
movement real" verification (STORY-012); favorable-vs-unfavorable direction
(the MCP tool has it; not needed for the send/no-send gate).

## Safety constraints

- No secrets in code, logs, or alert content. Alert bodies contain only KPI
  labels and numbers. When real adapters land, the API key/webhook URL is read
  from env and redacted in every log line.
- Threshold and cache size stay env-configurable, never hardcoded past the
  documented defaults.
- The alert never invents a number: `reason` strings are formatted from the
  typed `KpiAlert` values only.

## Verification

- `backend/src/services/alertDetectionService.test.ts` — 12 tests: threshold
  boundary, below/at/above, decrease, unchanged, new/dropped KPI, zero baseline,
  weaker-evidence, multiple alerts, default + env-driven threshold.
- `backend/src/services/notificationService.test.ts` — 9 tests: content
  (single/multi/low-confidence), key stability, empty → no send + no
  `alert_sent`, happy multi-channel + `alert_sent` body, idempotent re-send,
  failing channel retried then recorded and **not** remembered, partial success
  counts as sent then dedupes, real dry-run transports by default.
- `backend/src/routes/alertsRoute.test.ts` — 6 tests: `no_data`, `no_baseline`,
  `no_changes`, `sent` (+ `alert_sent` carries the body), idempotent →
  `already_sent`, `send_failed` → 502.
- `tsc --noEmit` clean (includes the `alertsContract` `AssertAssignable`
  guards). Full backend suite: 81 tests passing.
- Live end-to-end: upload baseline → `no_baseline`; upload +50% revenue → `sent`
  with 5 alerts, email + slack dry-run `sent`, `alert_sent` line carried the
  full 5-line body; re-run → `already_sent`, nothing re-delivered.
