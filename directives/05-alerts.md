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
- `backend/src/services/pendingAlertStore.ts` — the human-approval-hold store
  (STORY-012 / REQ-013; see "Human-approval hold" below).
- `POST /api/alerts/run` — the trigger endpoint.
- `POST /api/alerts/:id/approve`, `POST /api/alerts/:id/reject`,
  `GET /api/alerts/pending` — the approval-hold endpoints.
- Env: `ALERT_THRESHOLD_PCT` (default 15), `ALERT_DEDUP_CACHE_SIZE` (default 256),
  `ALERT_REQUIRE_APPROVAL` (default `true`; see "Human-approval hold" below),
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
  - `pending_approval` — significant changes drafted and held for a human
    (`ALERT_REQUIRE_APPROVAL=true`, the default — STORY-012 acceptance #1: the
    system requires verification before it will send)
  - `already_sent` — this exact set of changes was already alerted on
    (**gate off only**; under the gate a replay reports `pending_approval`
    again against the same `alertId` instead — see "Human-approval hold")
  - `sent` — at least one channel delivered (STORY-004 acceptance #1; under
    the gate this comes from `POST /api/alerts/:id/approve`, not `run`)
  - `send_failed` — significant changes, but every channel failed (**HTTP 502**)
  - body carries `alertId`, `thresholdPct`, the `alerts[]` (full `KpiAlert`
    objects), per-channel `channels[]`, and `content` (the drafted
    `AlertContent`, non-null only for `pending_approval`).
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

## Human-approval hold (STORY-012 / REQ-013, built 2026-09-11)

**Built, replacing the "no human-approval hold exists" gap flagged during the
STORY-012 walking-skeleton pass.** `sendKpiAlert` itself is unchanged — it
still sends the instant it's called — but `POST /api/alerts/run` no longer
calls it directly. Instead:

- `ALERT_REQUIRE_APPROVAL` (env, default `true` — any value other than the
  literal string `'false'` keeps the hold up, so a mistyped or empty value
  fails safe). Read once at module load, same pattern as
  `ALERT_THRESHOLD_PCT`/`readThresholdPct`.
- **Gate on (default):** a significant change is drafted (`buildAlertContent`)
  and stored in `pendingAlertStore.ts` keyed by the same `deriveAlertKey` id
  `notificationService` already computes — idempotent by construction, not by
  an extra check: replaying detection for an unchanged pair of calculations
  finds the existing entry (`upsertPending`) instead of drafting a duplicate.
  `run` returns `pending_approval` with the id and drafted `content`;
  `sendKpiAlert` is never invoked from this path.
- A human calls `POST /api/alerts/:id/approve` to actually send (this is what
  finally calls `sendKpiAlert`) or `POST /api/alerts/:id/reject` to discard it
  — the "false positive → verification fails → no alert sent" path
  (STORY-012 acceptance #2). `GET /api/alerts/pending` lists what's waiting.
- Approving twice does not send twice: once an entry is `approved`, its
  `sendResult` is cached on the entry and reused verbatim on a repeat
  `approve` call — the route never attempts a second send it already knows
  the outcome of. `notificationService`'s own `sentAlertKeys` dedup remains
  the backstop underneath. Rejecting an already-approved entry, or approving
  an already-rejected one, is refused with an explicit 4xx (`409`,
  `AlreadyApproved` / `AlreadyRejected`), never a silent no-op. An unknown id
  on either endpoint is `404 NotFound`.
- `pending_approval` / `alert_approved` / `alert_rejected` structured log
  lines (same JSON shape as `alert_check`/`alert_sent`, via the now-exported
  `notificationService.logAlertEvent`) satisfy STORY-012 acceptance #3 ("every
  KPI change verification must be logged with the result and timestamp").
- **Gate off (`ALERT_REQUIRE_APPROVAL=false`):** `run` behaves exactly as it
  did before this hold existed — immediate send, `already_sent` on replay,
  `502 send_failed` if every channel fails. This is the intentional "once
  you trust it, flip it to fully autonomous" switch — a single env var, not a
  code branch to remember to delete later. Only flip it off on explicit
  instruction that the team is ready to trust the hold.
- Documented limitation: if an `approve` call's send fails and the entry is
  cached as `approved` with a failed `sendResult`, there is currently no
  "retry the send" action short of a fresh detection cycle producing a new
  (differently-keyed) alert — acceptable for now since `sendKpiAlert` already
  retries each channel internally before giving up; a `POST .../retry`
  endpoint is a harden-pass candidate if this proves painful in practice.
- Do not wire real Mandrill/Slack credentials into `emailTransport.ts` /
  `slackTransport.ts` while relying on anything other than this explicit gate
  to keep sends from firing automatically.

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
`KpiAlert`, not free text), double-send (idempotency key + dedup set, plus the
approval-hold's own "already approved → reuse cached result" short-circuit),
a rejected/false-positive change being sent anyway (the hold refuses to send
without an explicit approve, and refuses to approve an already-rejected id),
an approve/reject call replaying against an id that's already moved on
(explicit 4xx, not a silent no-op).

Not handled (documented, deferred): real email/Slack delivery (dry-run only
until the harden pass); per-channel retry-later after a partial success;
durable/cross-process dedup, pending-alert, and alert history (STORY-014);
retrying a failed *approved* send without a fresh detection cycle (see
"Human-approval hold" above); an automated statistical/data-artifact check
that a move isn't a one-off glitch (today's "verification" is the human
approval act itself, not an algorithmic anomaly detector — a deliberate,
documented interpretation, not an oversight); favorable-vs-unfavorable
direction (the MCP tool has it; not needed for the send/no-send gate).

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
- `backend/src/routes/alertsRoute.test.ts` — 13 tests across three groups:
  gate-on (default) — `no_data`, `no_baseline`, `no_changes`,
  `pending_approval` drafted with content and no send attempted, idempotent
  replay finds the existing pending entry; approve/reject/pending-list —
  happy path (draft → list → approve → sent → drops off the list), reject
  path (drops off the list, re-reject is a no-op, approve-after-reject is a
  409), double-approve idempotency (send called once), unknown id → 404 on
  both endpoints, send-target-unreachable → 502 on approve and a repeat
  approve reuses the cached failure without re-sending, empty pending list;
  gate-off (`ALERT_REQUIRE_APPROVAL=false`, via `jest.isolateModules` so the
  load-time env read takes effect) — immediate send + `already_sent` replay +
  full-body `alert_sent` log line (byte-for-byte the pre-STORY-012 behavior),
  and `502 send_failed` when every channel fails.
- `backend/src/services/pendingAlertStore.test.ts` — 16 tests: create,
  get-or-create idempotency (a replay with different alerts/content is
  ignored — the original entry wins), independent ids, approve transitions
  (success and failure outcomes both recorded, no-op when already approved,
  refuses to flip a rejected entry), reject transitions (idempotent, refuses
  to flip an approved entry), sorted pending listing, empty listing, unknown
  id on every lookup, store reset.
- `tsc --noEmit` clean (includes the extended `alertsContract`
  `AssertAssignable` guards). Full backend suite: 115 tests passing (was 92
  before the approval-hold build).
- Live end-to-end from the original STORY-004 build (still valid for the
  gate-off path, unexercised for gate-on pending a fresh manual pass): upload
  baseline → `no_baseline`; upload +50% revenue → `sent` with 5 alerts, email
  + slack dry-run `sent`, `alert_sent` line carried the full 5-line body;
  re-run → `already_sent`, nothing re-delivered.
