# Directive 07: Subscription Plans (STORY-006)

## Goal

Let a business owner select one of five subscription tiers, gate uploads on
that plan being active (not expired) and within its row limit, and log every
subscription change and every usage check.

Satisfies REQ-007 (FUNC, must) — "provide subscription plans with different
upload limits: Free, $9/month, $19/month, $39/month, $79/month."

## Confirmed with the project owner before building (2026-09-14)

- No payment processor credential exists (no Stripe or equivalent). The Free
  tier needs no payment at all; the four paid tiers go through a dry-run
  `PaymentProcessor` adapter, same shape as `emailTransport.ts` — real
  credentials are a harden-pass follow-up, not this story.
- This codebase has no user/account concept anywhere (no models, no
  database, no auth — every existing store, `latestKpiStore` /
  `pendingAlertStore` / `financialRecordStore`, is a single global in-memory
  state). "My account" is modeled the same way: one global
  `subscriptionStore`, not a multi-tenant account system. Building real
  accounts is out of scope for "manage subscription plans."
- Acceptance #2 requires touching `uploadRoute.ts` (gating an upload on the
  active plan) — flagged and agreed before building, per the project's
  "don't silently touch a file outside this story" rule.

## Inputs (new, this story)

- `backend/src/services/subscriptionPlans.ts` — the static plan catalog:
  id, price, label, `maxRowsPerUpload` per tier.
- `backend/src/services/subscriptionStore.ts` — single global in-memory
  subscription state (current plan, `selectedAt`, `expiresAt`), same
  walking-skeleton pattern as `latestKpiStore.ts`.
- `backend/src/services/paymentProcessor.ts` — the `PaymentProcessor`
  interface plus a dry-run adapter (no real charge; see "Delivery" below).
- `backend/src/services/subscriptionService.ts` — orchestration:
  `selectPlan` (payment + state update, idempotent), `assertSubscriptionActive`
  and `assertWithinUsageLimit` (the two upload-gating checks, also this
  story's usage-logging point).
- `backend/src/routes/subscriptionRoute.ts` / `subscriptionContract.ts` —
  `POST /api/subscription/select`, zod-validated, following the
  `alertsRoute.ts` pattern.
- Minimal, additive changes to existing files (see "Upload integration"):
  `backend/src/routes/uploadRoute.ts` (two new gate checks) and
  `backend/src/routes/uploadContract.ts` (two new `errorClass` values).
- Env: `PAYMENT_TIMEOUT_MS` (default 10000), `PAYMENT_RETRIES` (default 2) —
  reusing `processingAudit.runStep`, not a new retry mechanism.

## Plan catalog

Row limits are a **placeholder** — REQ-007 specifies prices, not limit
values, so these are a documented assumption pending real product input,
not a guess presented as fact:

| id | price | maxRowsPerUpload |
|---|---|---|
| `free` | $0 | 1,000 |
| `plan_9` | $9 | 5,000 |
| `plan_19` | $19 | 15,000 |
| `plan_39` | $39 | 50,000 (matches `DEFAULT_MAX_DATA_ROWS`) |
| `plan_79` | $79 | 200,000 |

`free` never expires (`expiresAt: null`); every paid plan expires
`SUBSCRIPTION_PERIOD_DAYS` (placeholder: 30) after `selectedAt` — a stand-in
for a real billing calendar, which needs a real payment processor to be
worth building.

The default subscription, before anyone ever calls select, is `free` and
active. This is deliberate: it means every existing upload test keeps
passing unchanged — nothing is gated until an account either never selects
a plan (stays on free) or its paid plan expires.

## What "my account is updated accordingly" means (acceptance #1)

`selectPlan(planId)`:
1. Unknown `planId` → `invalid_plan`, nothing charged or changed (**Plan
   selection failure**).
2. Requested plan == current plan AND current is still active → `already_active`,
   **no charge attempted** — this is the idempotency guarantee: selecting
   the plan you're already on cannot double-charge you, whether that's a
   genuine repeat click or a client retry.
3. Otherwise, if the plan is paid: charge via `PaymentProcessor.charge()`
   through `runStep` (explicit timeout, capped retries). On failure (all
   retries exhausted) → `payment_failed`, **the stored subscription is not
   touched** — a failed charge never leaves the account half-updated
   (**Payment processing error**, and the guardrail "ensure data accuracy
   and integrity throughout the process": no partial state, ever).
4. On success (or immediately, for the free plan): store the new
   `{ planId, selectedAt: now, expiresAt }` and return `updated`.

Every outcome (`updated`, `already_active`, `payment_failed`, `invalid_plan`)
logs a `subscription_changed` line — including the no-op, since "nothing
changed" is itself a fact worth the audit trail having.

## Upload integration (acceptance #2 + "Usage limit exceeded")

Two checks, both new, both minimal and additive — nothing about the existing
upload success path changes when the account is active and within limit:

1. **`assertSubscriptionActive()`** — called first, before any file
   processing (cheap: no reason to parse a file for an expired account).
   Expired paid plan → `SubscriptionExpiredError` → **402**, `errorClass:
   'SubscriptionExpired'`, message prompts renewal (acceptance #2, literally
   "the system prompts for renewal").
2. **`assertWithinUsageLimit(cleaning.totalDataRows)`** — called after
   `cleanFile` succeeds (row count is only known once the file is parsed),
   before `calculateKpis`/`setLatest`. Over the active plan's
   `maxRowsPerUpload` → `UsageLimitExceededError` → **402**, `errorClass:
   'UsageLimitExceeded'` (the **Usage limit exceeded** failure path).

Both checks run on every call — allowed or blocked — and both log a
`subscription_usage` line (the "logs... usage" half of the Trust criterion).

This is deliberately independent of `UPLOAD_MAX_ROWS` (the existing global
event-loop-protection cap in `uploadContract.ts`): that cap stays exactly as
it is, still passed into `cleanFile` unchanged. The plan's row limit is a
*separate*, billing-driven check layered on top, not a replacement — a
request can fail either cap for a different reason, with a different
`errorClass`, so a client can tell "your file is absurdly large" apart from
"upgrade your plan" apart from "your data is malformed."

`uploadContract.ts`'s `UploadErrorResponseSchema.errorClass` gains
`'SubscriptionExpired'` and `'UsageLimitExceeded'` alongside the existing
`'ValidationError'` / `'UnknownError'`.

## Idempotency

`selectPlan` on an already-active identical plan is a no-op (see above) —
the core "must not double-charge" guarantee. Re-checking upload gates on
every call is naturally idempotent: both checks are pure reads of the
current subscription state, no side effect to duplicate.

## Delivery (walking-skeleton shortcut — no credentials)

`paymentProcessor.ts`'s dry-run adapter always reports success and logs that
it's in dry-run mode — no real charge, no OAuth, no API key. Tests that need
a failing charge inject their own fake `PaymentProcessor` (same pattern as
`financialSyncService.test.ts`'s `fakeSource`), not a special flag on the
real adapter.

**Harden pass (follow-up, not this story):** a real Stripe (or equivalent)
adapter behind an env gate, same "credential present but real client not
built yet → warn and stay dry-run" pattern as `emailTransport.ts`.

## Guardrails not otherwise addressed above

- "Maintain a record of insights and allow users to undo changes" — does not
  apply to subscription changes as built here; an "undo a plan change"
  action (which would imply a refund, not just a state flip) is explicitly
  out of scope for this walking skeleton. Documented limitation, not a
  silent gap.
- "Verify significant drops or increases in KPIs before sending alerts" —
  not applicable to this story's domain.

## Edge cases

- Selecting `free` while already on `free` → `already_active`, no charge (it
  was already free, so this is also trivially true for "no charge").
- Selecting a paid plan while an existing paid plan is still active (not
  expired) → charges for the new plan and replaces the old one; no proration
  (documented limitation, not built).
- Selecting the same paid plan again *after* it has expired → charges again
  (this is a legitimate renewal, not a double-charge — the prior period is
  over).
- An upload while on `free` (never expires) → only the usage-limit check can
  block it, never the expiry check.
- A file whose row count is fine for the account's plan but over the global
  `UPLOAD_MAX_ROWS` cap → blocked by the existing, unrelated mechanism
  (`ParseError` → `ValidationError`), not this story's checks.

## Failure modes handled vs not handled

Handled (the three failure paths this story must cover): **Payment
processing error** (`runStep` timeout + capped retry around the charge; on
exhaustion, `payment_failed` and the stored subscription is untouched);
**Plan selection failure** (`invalid_plan` for an unknown id — never falls
back to a default plan silently); **Usage limit exceeded**
(`assertWithinUsageLimit`, independent of the unrelated global upload-size
cap, its own `errorClass` and message).

Not handled (documented, deferred): a real payment processor (dry-run only
until credentials exist); durable/cross-restart subscription state
(in-memory walking-skeleton store, same limitation as every other store in
this codebase); multi-tenant accounts (single global subscription, as
agreed above); proration or refunds on a plan change; an "undo this
subscription change" action.

## Safety constraints

- No secrets in code, logs, or fixtures. When a real processor lands, its
  key is read from env and redacted in every log line, same as the
  Mandrill/Slack/financial-sync pattern.
- Timeout and retry counts stay env-configurable, never hardcoded past the
  documented defaults.
- Payment amounts and plan ids may appear in logs (this is the account's own
  billing state, not a third-party secret); a real card number or processor
  token never would, once the harden pass lands.

## Verification (to be filled in as the walking skeleton lands)

- Unit tests for `subscriptionService`: select free (no charge), select a
  paid plan (charge succeeds, state updates), unknown plan id
  (`invalid_plan`), re-selecting the same active plan (`already_active`, no
  charge — assert the fake processor's charge count), payment failure after
  retries (`payment_failed`, subscription unchanged), renewing an expired
  plan (charges again).
- Unit tests for the two upload-gate checks: active + within limit → not
  blocked; expired paid plan → blocked; over the row limit → blocked; both
  log a `subscription_usage` line.
- `backend/src/routes/subscriptionRoute.test.ts` and additive cases in
  `uploadRoute.test.ts` for the two new gates (including: existing
  happy-path upload tests still pass unchanged on the default `free`
  account).
- `tsc --noEmit` clean; no regressions in the existing suite.
