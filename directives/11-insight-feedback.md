# Directive 11: Collect User Feedback on Insights (STORY-009)

## Goal

Let a business owner rate a KPI's accuracy, prompt for feedback on any KPI
that doesn't have it yet, and log every piece of feedback received along
with what it says about the system's own confidence. Satisfies REQ-011
(FUNC, must) — "provide user feedback mechanisms on insight accuracy."

## Confirmed with the project owner before building (2026-09-19)

- **"An insight" = a specific `(kpiKey, generatedAt)` pair** — a
  particular KPI's value from a particular calculation, not the key in
  the abstract. Last month's "revenue is $5,000" and this month's
  "revenue is $7,000" are different insights; feedback on one must not
  silently apply to the other.
- **Submitting feedback twice for the same insight updates it in place,
  never duplicates it** — the idempotency mandate, same as every
  side-effecting write in this codebase.
- **"Impact"** (Trust criterion #3) is a logged, derived note — whether
  the feedback confirms or contradicts the system's own `evidenceLevel`
  for that KPI — not an actual change to any calculation. Building a
  feedback-driven re-training loop is well beyond a walking skeleton and
  no acceptance criterion asks for it.
- **Backend is two new, independent endpoints** (submit feedback; check
  feedback status) specifically so `dashboardRoute.ts` /
  `dashboardContract.ts` (STORY-003) never need to change.
- **`KpiCard.tsx` / `Dashboard.tsx` (STORY-003/007) do need to change** —
  criterion #2 ("the system prompts for feedback") is a UI requirement;
  nothing renders itself. Agreed and flagged before building.

## Inputs (new, this story)

- `backend/src/services/feedbackStore.ts` — in-memory, keyed by
  `(kpiKey, generatedAt)`. Same walking-skeleton pattern as every other
  store in this codebase.
- `backend/src/services/feedbackService.ts` — `submitFeedback(params)`
  (validates the insight actually exists in the latest calculation before
  recording; computes the impact note) and `getFeedbackStatus(generatedAt)`
  (which KPI keys in that calculation already have feedback, which don't).
- `backend/src/routes/feedbackRoute.ts` / `feedbackContract.ts` —
  `POST /api/insights/feedback`, `GET /api/insights/feedback-status`.
- `frontend/src/components/KpiCard.tsx` (additive) — a feedback prompt
  (accurate/inaccurate + optional comment) when the insight has none yet;
  a confirmation when it does.
- `frontend/src/pages/Dashboard.tsx` (additive) — fetches feedback status
  alongside KPIs, passes per-KPI feedback state down, handles submission.
- `frontend/src/services/feedbackApi.ts` — the fetch client for the two
  new endpoints, same timeout+retry shape as `kpiApi.ts`.

## What "the system records it" means (acceptance #1)

`submitFeedback` first confirms `kpiKey` actually appears in
`latestKpiStore.getLatest()`'s KPIs **and** that calculation's
`generatedAt` matches what was submitted — refusing to record feedback
against an insight it can't verify is the direct guard against
**Feedback not recorded** silently accepting garbage. Documented
limitation: `latestKpiStore` only keeps the two most recent calculations
(`latest`/`previous`); feedback submitted against anything older than
`latest` reports `insight_not_found` rather than being validated against
history that no longer exists — consistent with every other consumer of
that store in this codebase.

A resubmission for the same `(kpiKey, generatedAt)` is `updated`, not a
duplicate entry — `feedbackStore`'s key IS the dedup mechanism, same
pattern `financialRecordStore`/`pendingAlertStore` already use.

## What "prompts for feedback" means (acceptance #2)

`getFeedbackStatus(generatedAt)` returns every KPI key from that
calculation split into `kpiKeysWithFeedback` / `kpiKeysNeedingFeedback`.
`Dashboard.tsx` fetches this alongside `GET /api/kpis` and passes each
KPI's feedback state to `KpiCard`, which renders the prompt only for
keys in `kpiKeysNeedingFeedback` — **Feedback prompt not shown** is
guarded by a test asserting the prompt renders exactly when a key is in
that list and not otherwise, at both the component and page level (same
two-layer proof STORY-007 used for the low-confidence badge).

## Outputs

- `POST /api/insights/feedback` → `{ outcome: 'recorded' | 'updated' | 'insight_not_found', correlationId, entry? }`.
  `recorded`/`updated` → `200`; `insight_not_found` → `404` (same
  "unknown reference → 404, never a silent no-op" rule `alertsRoute.ts`
  already uses for an unknown pending-alert id).
- `GET /api/insights/feedback-status?generatedAt=...` →
  `{ generatedAt, kpiKeysWithFeedback: string[], kpiKeysNeedingFeedback: string[] }`,
  always `200` — an empty result for a `generatedAt` that isn't the
  current latest is a legitimate answer, not an error.
- `X-Correlation-ID` header sharing the response body's own id (the fix
  already made this session in `syncRoute.ts` / `reportRoute.ts` /
  `detailedReportRoute.ts` — not repeating that mistake a fourth time).
- A `feedback_received` structured log line on every submit attempt —
  recorded, updated, or rejected as `insight_not_found` — carrying the
  rating, the computed impact note, and a timestamp (Trust criterion).

## Idempotency

Resubmitting feedback for the same insight updates the stored entry in
place (see above) — the same guarantee `financialRecordStore`'s upsert
and `pendingAlertStore`'s "already approved → reuse" already provide
elsewhere in this codebase.

## Failure paths

Handled (all three required): **Feedback not recorded** (the
insight-existence check above — nothing is stored unless it's tied to a
real, current insight); **Feedback prompt not shown** (the
`kpiKeysNeedingFeedback` list is the single source of truth for whether
to render the prompt, tested at both layers, not inferred by the UI
guessing); **User interface issues** — the feedback submission call in
the frontend uses the same timeout+capped-retry+friendly-error shape
`kpiApi.ts` already established for `GET /api/kpis`, so a failed submit
shows a clear message and lets the user retry rather than the UI hanging
or silently losing the attempt.

## Guardrails not otherwise addressed above

- "Maintain a record of insights and allow users to undo changes" — this
  story records feedback *about* insights; it is not the insights-record-
  with-undo REQ-010/STORY-014 describes, and no undo action is built here.
- "Verify significant drops or increases in KPIs before sending alerts" —
  already built, separately, in STORY-012.
- "Ensure data accuracy and integrity throughout the process" — the
  insight-existence check above is this guardrail in action: refusing to
  record feedback that can't be tied to real, current data.

## Verification (to be filled in as the walking skeleton lands)

- `feedbackStore.test.ts`: record + resubmit-updates-in-place (not a
  duplicate), independent keys per `(kpiKey, generatedAt)`, status lookup,
  reset seam.
- `feedbackService.test.ts`: happy path records against a real latest
  calculation; resubmission is `updated`; an unknown `kpiKey` or stale
  `generatedAt` is `insight_not_found`, nothing stored; the impact note
  differs for confirming vs. contradicting a high-confidence insight;
  `feedback_received` logs on every branch including the rejection.
- `feedbackRoute.test.ts`: `POST /api/insights/feedback` happy path
  (`200`), unknown insight (`404`), correlation id header matches body;
  `GET /api/insights/feedback-status` reflects real feedback state.
- `KpiCard.test.tsx` (additive): prompt renders when the KPI needs
  feedback, not when it already has it; submitting calls the right
  handler with the right payload.
- `Dashboard.test.tsx` (additive): the feedback-status fetch drives which
  cards show the prompt at the page level; a submit failure shows a
  friendly error, not a crash.
- `tsc --noEmit` (backend + frontend) clean; no regressions.
