# Directive 09: Summary Reports (STORY-008)

## Goal

Generate a summary report of decisions made in the system, so a business
owner can review business actions taken. Satisfies REQ-012 (FUNC, must) —
"generate summary reports showing decisions made."

## Confirmed with the project owner before building (2026-09-19)

Nothing in this codebase has ever defined "a decision" or "a business
action" — this story is the first to need that definition, not something
already implicit elsewhere. Confirmed scope:

- **A "decision" is:** a subscription plan change that actually took effect
  (`subscriptionService.selectPlan`'s `updated` outcome), or a human
  approving/rejecting a drafted KPI alert (`alertsRoute.ts`'s `/approve` /
  `/reject`). Both are the closest things this system has to "reviewing
  business actions" — a deliberate, consequential choice, not the system
  asking a question or an automated background job running.
- **Explicitly excluded, and why:** KPI clarifications (the system *asking*
  isn't a decision *made* — STORY-009, not this one, is where a user's
  answer would eventually be captured); financial sync runs (automated,
  not a choice); no-op or failed attempts — `already_active`,
  `payment_failed`, `invalid_plan`, an idempotent repeat approve/reject —
  because nothing changed, so there is nothing to report as a decision.
  Recording a no-op as if it were a decision would itself be "incorrect
  report content" (a required failure path for this story).
- **STORY-014** ("insights + undo") is a separate, later story (release
  r4, blocked by STORY-009) — this directive does not build undo or
  versioning, only reporting.
- Touching `subscriptionService.ts` and `pendingAlertStore.ts`/
  `alertsRoute.ts` is required and agreed: nothing in this codebase
  currently keeps a *history* of these events (`subscriptionStore` only
  holds the current plan; `pendingAlertStore` only holds
  currently-pending/just-resolved entries), so recording a decision has to
  happen at the exact point each one actually occurs.

## Inputs (new, this story)

- `backend/src/services/decisionLog.ts` — the in-memory, append-only
  decision history. Same walking-skeleton pattern as `latestKpiStore.ts` /
  `pendingAlertStore.ts` / `financialRecordStore.ts` / `subscriptionStore.ts`:
  a single global list, not a database, not per-user. Lost on restart —
  durable history is a later persistence story, same caveat every other
  store in this codebase already carries.
- `backend/src/services/reportService.ts` — `generateSummaryReport()`:
  reads the decision log and produces a typed report.
- `backend/src/routes/reportRoute.ts` / `reportContract.ts` —
  `GET /api/reports/summary`, zod-validated, following the
  `dashboardRoute.ts` pattern (a pure read of current in-memory state, no
  request body).
- Minimal, additive changes to existing files: `subscriptionService.ts`
  (record a decision on a real plan change) and `alertsRoute.ts` (record a
  decision on a genuine approve/reject transition, not a replay).

## What "includes all relevant decisions" means

`DecisionEntry`:
```
{
  id: string;               // unique, one per recorded decision
  type: 'subscription_change' | 'alert_approved' | 'alert_rejected';
  summary: string;          // one human-readable sentence
  occurredAt: string;       // ISO-8601, when the decision was made
  context: Record<string, unknown>;  // structured detail (plan id, alert id, etc.)
}
```

`recordDecision` is called at the exact moment a qualifying decision
happens — inside `selectPlan`'s `updated` branch, and inside the
alerts route's approve/reject handlers — never inferred after the fact by
re-scanning other stores. This is the direct guard against **Data
omission**: if it's not recorded at the moment it happens, no later
report-generation logic can reconstruct it, so the recording point itself
is the correctness boundary, not the reading logic.

Both integration points guard against double-recording an idempotent
replay:
- `selectPlan` only calls `recordDecision` in the `updated` branch, which
  (per `directives/07-subscriptions.md`... `06`) only executes on a genuine
  state change — never on `already_active`.
- The approve handler only records inside the fresh-send branch, not the
  "already approved, reused cached result" branch. The reject handler
  captures whether the entry `was` `pending` *before* calling
  `markRejected`, and only records if it genuinely transitioned — a
  repeat reject on an already-rejected entry stays a true no-op.

## What "indicates no actions taken" means (acceptance #2)

`generateSummaryReport()` returns `status: 'no_actions'` when the decision
log is empty — not an error, not an empty-but-ambiguous list. This is the
direct counterpart to `dashboardRoute.ts`'s `{ status: 'no_data' }` for an
empty `latestKpiStore` — same shape of "explicitly say there's nothing,
don't make the caller infer it from an empty array."

## Outputs

- `GET /api/reports/summary` → `{ status: 'ok' | 'no_actions', generatedAt, correlationId, decisionCount, decisions: DecisionEntry[] }`.
- `X-Correlation-ID` response header, same convention as every other route
  in this codebase.
- A `report_generated` structured log line on every call (Trust criterion
  — "logs all report generation activities"), carrying `status`,
  `decisionCount`, and the correlation id.

## Idempotency

Generating the same report twice in a row (no new decisions in between)
returns the same `decisionCount` and the same decisions — a report is a
read, not a side effect, so there is nothing to double here by
construction. The thing that *is* guarded for double-recording is the
decisions themselves (see above), not the report generation act.

## Failure paths

- **Report generation failure** — `generateSummaryReport()` is a pure,
  synchronous read of an in-memory list; nothing in it can genuinely
  throw. The route still wraps it in a try/catch, mirroring
  `dashboardRoute.ts`'s `DashboardUnavailable` pattern, and returns a
  typed `502 ReportUnavailable` rather than an unhandled 500 if something
  unexpected happens — the same defensive shape this codebase uses
  everywhere else, even where the failure is currently unreachable.
- **Incorrect report content** — guarded by only recording genuine state
  transitions (see above) and by `decisionCount === decisions.length`
  being asserted directly in tests, not just eyeballed.
- **Data omission** — guarded by recording at the moment of the decision,
  not reconstructing it later (see above); tested by checking every
  qualifying action (a real plan change, an approve, a reject) actually
  produces exactly one decision entry, no more, no fewer.

## Guardrails not otherwise addressed above

- "Maintain a record of insights and allow users to undo changes" — this
  decision log is a record, but it is not the "insights" record REQ-010 /
  STORY-014 describes, and no undo capability is built here. Documented
  boundary, not a silent gap.
- "Verify significant drops or increases in KPIs before sending alerts" —
  already built, separately, in STORY-012.
- "Ensure data accuracy and integrity throughout the process" — this is
  what the "record only genuine transitions" rule above *is*: refusing to
  report a decision that didn't really happen.

## Verification (to be filled in as the walking skeleton lands)

- `decisionLog.ts`: record + list (sorted, newest first), empty listing,
  reset seam.
- `reportService.ts`: happy path (decisions present → `ok`, correct
  count), no-actions path (`no_actions`), `report_generated` audit line.
- `subscriptionService.test.ts` (additive): a real plan change records
  exactly one decision; `already_active` records none; `payment_failed`
  records none.
- `alertsRoute.test.ts` (additive): approve records exactly one decision;
  a reused/idempotent approve records none; reject records exactly one;
  a repeat reject on an already-rejected entry records none.
- `reportRoute.test.ts`: `GET /api/reports/summary` contract-valid
  response for both `ok` and `no_actions`, correlation id header.
- `tsc --noEmit` clean; no regressions in the existing suite.
