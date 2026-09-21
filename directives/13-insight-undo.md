# Directive 13: Insight Version History + Undo (STORY-014)

## Goal

Keep a real version history of insight feedback (STORY-009) and let a
user undo the most recent change, restoring the state before it. Satisfies
REQ-010 (SAFE, must) — "maintain a record of insights and allow users to
undo changes." This is the last story in the plan.

## Confirmed with the project owner before building (2026-09-21)

- **"An insight" is exactly what STORY-009 already defined**: a specific
  `(kpiKey, generatedAt)` pair. **"A change" is submitting or resubmitting
  feedback on one.** `blocked_by: STORY-009` in the plan is the concrete
  signal for this — not STORY-008's decisions, not STORY-006's
  subscriptions.
- **Deliberately out of scope, and why:** undoing a decision (STORY-008 —
  a sent alert, a subscription change) is not built here. Those are
  genuinely irreversible in the real-world sense — an alert email can't be
  un-sent, and un-charging a subscription needs a refund flow this
  walking skeleton doesn't have. Feedback, by contrast, is just a data
  point — honestly and trivially reversible. This scope boundary is also
  what gives the **"Irreversible change"** failure path a second, larger
  meaning: a whole category of change this mechanism doesn't claim to
  undo, not just a boundary case inside feedback history.
- **History is append-only, never destructively edited** — same
  philosophy every other store in this codebase already uses
  (`decisionLog`, `feedbackStore`, `satisfactionStore`: nothing is ever
  deleted). Undo does not erase the change it reverses; it **appends a
  new version whose content restores the prior state** — the `git
  revert` model, not `git reset`. This means undoing twice in a row
  toggles back and forth predictably (undo of an undo restores the
  version before *that*), and the full history stays inspectable.
- **The unavoidable "outside this story" touch:** `feedbackService.ts`
  (STORY-009)'s `submitFeedback` needs one additive call — push a new
  version on every successful recording. No change to `feedbackStore.ts`
  itself; the version history is a separate, new store that watches what
  `feedbackService` already does.

## Data model

```
InsightVersionEntry = {
  id: string;
  kpiKey: string;
  generatedAt: string;        // identifies the insight, same as STORY-009
  rating: FeedbackRating;
  comment: string | null;
  recordedAt: string;
  reason: 'change' | 'undo';  // why this version exists
}
```

`insightVersionStore.ts` — keyed by `(kpiKey, generatedAt)`, each key
holding its own ordered, append-only list. Same walking-skeleton pattern
as every other store here: in-memory, lost on restart.

## What "allow the user to undo the change" means (acceptance #1)

Every successful `submitFeedback` call (STORY-009) also appends a
`reason: 'change'` version here — additive, one new call inside an
existing success branch, nothing about `feedbackService`'s own return
value changes.

## What "restore the previous state" means (acceptance #2)

`undoInsightChange(kpiKey, generatedAt)`:
- Fewer than 2 versions in history → **`irreversible`** (nothing before
  the current state to restore to — this covers both "no change was ever
  made" and "this is the first-ever version"). Nothing is written.
- 2 or more → take the version **before** the most recent one, append it
  again as a new `reason: 'undo'` version (the `git revert` model above),
  and update `feedbackStore` (STORY-009's live state) to match in the
  same synchronous call — history and live state can never diverge,
  because nothing asynchronous happens between the two writes. **This is
  the direct guard against "Version control error"**: there is no gap
  for the two to get out of sync in.

## Outputs

- `POST /api/insights/undo` (body: `{ kpiKey, generatedAt }`) →
  `{ outcome: 'restored', restoredRating, restoredComment, correlationId }`
  or `{ outcome: 'irreversible', correlationId }` — both `200`, matching
  this codebase's existing pattern of treating an expected non-error
  outcome (`no_data`, `no_actions`, `insufficient_data`) as `200` with a
  status field, not a 4xx. The route wraps the call in a try/catch,
  returning a typed `502 UndoUnavailable` if something unexpected throws
  — **the guard against "Undo operation failure"**, same defensive shape
  `dashboardRoute.ts`/`reportRoute.ts`/`detailedReportRoute.ts` already
  use even where currently unreachable.
- A structured log line on every branch — restored, irreversible, *and*
  every original change — carrying a timestamp (Trust criterion #3,
  and the guard against **"Logging failure"**: nothing here can return
  without having logged first).

## What shows the Undo option, and the "User interface confusion" guard

The dashboard already knows, per KPI card, whether feedback exists
(STORY-009's `feedbackRating`). The Undo option is offered exactly when a
card currently has feedback — attempting to undo the very first-ever
submission correctly comes back `irreversible`, and the UI shows a plain
message ("Nothing earlier to undo to") rather than failing silently or
confusingly. No new "can this be undone" check endpoint is added — the
existing feedback state is sufficient, and the undo call itself is the
honest source of truth for whether it actually succeeded.

## Inputs (new, this story)

- `backend/src/services/insightVersionStore.ts` — append-only version
  history, keyed by `(kpiKey, generatedAt)`.
- `backend/src/services/insightVersionService.ts` — `recordInsightChange`
  (called from `feedbackService.submitFeedback`) and `undoInsightChange`.
- `backend/src/routes/insightUndoRoute.ts` / `insightUndoContract.ts` —
  `POST /api/insights/undo`.
- `frontend/src/services/insightUndoApi.ts` — fetch client, same
  timeout+retry shape as every other client here.
- `frontend/src/components/KpiCard.tsx` (additive) — an "Undo" action
  next to the existing feedback confirmation.
- `frontend/src/pages/Dashboard.tsx` (additive) — wires the undo call and
  re-renders the card's feedback state from the result.
- `backend/src/services/feedbackService.ts` (additive) — the one new call
  into `insightVersionService.recordInsightChange`.

## Failure paths

Handled (all five required): **Irreversible change** (fewer than 2
versions, and the whole decisions/subscriptions category, both by
design); **Undo operation failure** (route-level defensive try/catch,
`502`); **Version control error** (history and live state updated in one
synchronous call, no gap for them to diverge); **Logging failure** (every
branch logs, unconditionally); **User interface confusion** (Undo only
offered when there's real feedback to undo; a clear message on the
`irreversible` case, never a silent no-op).

## Guardrails not otherwise addressed above

- "Verify significant drops or increases in KPIs before sending alerts" —
  already built, separately, in STORY-012.
- "Ensure data accuracy and integrity throughout the process" — the
  synchronous, single-call history+live-state update above is this
  guardrail in action for this story specifically.

## Verification (to be filled in as the walking skeleton lands)

- `insightVersionStore.test.ts`: append + list oldest-first, independent
  histories per `(kpiKey, generatedAt)`, starts empty, reset seam.
- `insightVersionService.test.ts`: fewer than 2 versions → `irreversible`,
  2+ versions → restores the correct prior rating/comment and updates
  `feedbackStore` to match, undo-of-undo toggles back predictably, every
  branch logs with a timestamp.
- `feedbackService.test.ts` (additive): a successful `submitFeedback`
  call appends exactly one version; `insight_not_found` appends none.
- `insightUndoRoute.test.ts`: `POST /api/insights/undo` happy path,
  irreversible case, correlation id header matches body.
- `KpiCard.test.tsx` (additive): Undo renders only when feedback exists;
  clicking it calls the right handler.
- `tsc --noEmit` (backend + frontend) clean; no regressions.
