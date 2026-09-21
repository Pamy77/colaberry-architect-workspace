# Directive 12: UI Simplicity + Upload Screen (STORY-010)

## Goal

Make the upload path genuinely simple (REQ-018: three steps or fewer) and
operationalize "simple and intuitive" (REQ-014) as concrete, testable
properties instead of an unmeasurable subjective claim. Log meaningful UI
interactions (Trust criterion #3).

## Stopped and asked before building (2026-09-19) — acceptance criteria that cannot be tested as written

- **"Given a complex interface, when simplified, then user satisfaction
  increases" cannot be tested by this build, full stop.** No
  satisfaction-measurement mechanism exists anywhere in this codebase, and
  "increases" requires a real before/after measurement from real users,
  which this walking skeleton has neither the users nor the baseline for.
  **Not built at the time. Documented here as an explicit gap.**
  **Revisited 2026-09-21** — see "Satisfaction trend mechanism" below for
  what was actually built and why it's honest, not a fabricated metric.
- **"It is simple and intuitive" is a subjective UX judgment a test cannot
  assert pass/fail on.** Operationalized instead as a concrete, testable
  checklist (below) — this is the tested proxy; it is not a claim that the
  subjective criterion itself was "proven," and is documented as such.
- **Real, useful finding from investigating this:** REQ-018 currently
  cannot be satisfied at all — there is no upload screen anywhere in the
  frontend. Every upload this entire project has gone through a direct API
  call, never a UI. This is the one genuinely solid, buildable,
  objectively-testable piece of this story.

## What "simple and intuitive" is operationalized as

A checklist, each item concretely testable, not a vibe:
1. **Three steps or fewer to upload** (REQ-018, literally countable):
   choose a file, click Upload — **two** user actions, comfortably under
   budget.
2. **No navigation to get lost in.** The upload form lives inline at the
   top of the existing single-page dashboard, not a separate screen/route.
   This project has no router; adding one to satisfy "simple" would be the
   opposite of simple. **This is also the direct resolution of the
   "Navigation errors" failure path — there is no navigation surface for
   an error to occur in, by design.**
3. **Plain-language labels and a visible current state at every point** —
   already true of `Dashboard.tsx` (STORY-003/007/009); the upload form
   follows the same pattern (idle / uploading / success / error, each with
   plain text, never a raw error code).
4. **Basic accessibility**: a labeled file input, a real `<button>` (native
   keyboard operability, no custom click-handling on a `<div>`).

## Satisfaction trend mechanism (added 2026-09-21 — closing criterion #2 for real)

On 2026-09-19 this directive flagged criterion #2 ("user satisfaction
increases") as untestable and left it unbuilt rather than faked. Revisited
2026-09-21, with the project owner, to build a real mechanism instead of
leaving it permanently open. The reframing, agreed before writing any code:

**What "tested" means here is different from every other criterion in this
project, and that difference is deliberate.** Every other acceptance
criterion this session has been about proving a calculation or a flow is
*correct*. This one cannot honestly be "the real number went up" — there is
no real usage history yet for that to be true or false about. What CAN be
proven correct is the *mechanism*: given a real sequence of satisfaction
check-ins over time, does the system correctly compute whether the more
recent ones average higher, lower, or the same as the earlier ones. That
computation is exactly as testable as any other calculation in this
codebase (the KPI evidence-level math, the alert-threshold math), proven
with synthetic test numbers the same way those are.

**The guardrail, non-negotiable:** the real, running `satisfactionStore` is
never seeded with fabricated ratings to manufacture an "increased" result.
It starts genuinely empty, same as every other store in this codebase. Test
fixtures proving the trend math is correct live only in test files, never
in a script or migration that touches the real store. Until at least two
real check-ins exist, the honest answer is `insufficient_data` — the same
"say so plainly, don't guess" pattern already used everywhere else
(`no_data`, `no_actions`, `needs_clarification`). The criterion is marked
`true` in `.colaberry/progress.json` because the *mechanism* is real and
provably correct, not because a fabricated number says "increased."

### Data model

```
SatisfactionRating = 'great' | 'ok' | 'not_great'   (scored 3 / 2 / 1 — a
  3-point scale kept as 3 points, not stretched into a false-precision
  5-point average)

SatisfactionCheckin = { id, rating, submittedAt }
```

`satisfactionStore.ts` — append-only, single global in-memory list, same
walking-skeleton pattern as `decisionLog.ts`/`feedbackStore.ts`. No initial
seed data (the guardrail above, enforced by construction: there is no code
path that writes to this store except a real check-in submission).

### Trend calculation

Chronological split, not a calendar-window split: the earlier half of all
check-ins so far vs. the later half, by count, not by date range. A
calendar split (e.g. "this week vs last week") would report
`insufficient_data` indefinitely for a lightly-used walking skeleton even
with several real check-ins on the same day; a count-based split gives a
meaningful, honest answer as soon as there are enough check-ins to say
anything at all. Documented choice, not a hidden one.

- Fewer than 2 total check-ins → `insufficient_data`.
- 2 or more → split into first-half / second-half by count, average each
  half's numeric score, compare: later average higher → `increased`; lower
  → `decreased`; equal → `flat`.

### Inputs (added)

- `backend/src/services/satisfactionStore.ts` — record + list + reset seam.
- `backend/src/services/satisfactionService.ts` — `recordCheckin` and
  `computeSatisfactionTrend`.
- `backend/src/routes/satisfactionRoute.ts` / `satisfactionContract.ts` —
  `POST /api/satisfaction/checkin`, `GET /api/satisfaction/trend`.
- `frontend/src/services/satisfactionApi.ts` — fetch client, same
  timeout+retry shape as every other client in this codebase.
- `frontend/src/components/SatisfactionCheckin.tsx` (new) — three quiet
  buttons (🙂 Great / 😐 OK / 🙁 Not great), placed after the KPI content
  on `Dashboard.tsx`, not competing with the primary upload/KPI focus.

## What "logs user interactions" means (Trust criterion #3)

`POST /api/ui/interactions` — a lightweight, store-free endpoint (unlike
`decisionLog`/`feedbackStore`, nothing here needs to be read back by any
acceptance criterion, so no persistent store is built — an append-only
structured log line is the whole mechanism, same minimalism this
codebase already applies wherever a criterion doesn't ask for more).
The frontend reports `upload_started`, `upload_completed`, and
`upload_failed` from the new upload form.

## Inputs (new, this story)

- `backend/src/routes/uiInteractionRoute.ts` / `uiInteractionContract.ts` —
  `POST /api/ui/interactions`.
- `frontend/src/services/uploadApi.ts` — the upload fetch client, same
  timeout+capped-retry shape as `kpiApi.ts`/`feedbackApi.ts`. Retrying an
  upload is safe: `uploadRoute.ts` already dedupes by content hash
  (STORY-011), so a retried upload cannot double-create data.
- `frontend/src/services/uiInteractionApi.ts` — fire-and-forget reporting
  client for the interaction log; a failure here must never block or
  surface an error on the upload itself (logging is secondary to the
  primary action, same principle STORY-009's feedback-status fetch
  already established for Dashboard.tsx).
- `frontend/src/components/UploadForm.tsx` (new) — the two-step form.
- `frontend/src/pages/Dashboard.tsx` (additive) — renders `UploadForm`
  above the existing KPI content, and re-loads the dashboard on a
  successful upload so new data appears without a manual refresh.

## Failure paths

Handled (all three required): **Interface not intuitive** — guarded by
the operationalized checklist above being tested directly (step count,
label text, accessible markup), not asserted as a feeling; **User
dissatisfaction** — the upload form's error state uses the same
plain-language, "what happened + try again" pattern already established
for the dashboard's load error and feedback submission error, not a raw
technical message; **Navigation errors** — resolved by design (no
navigation surface exists to error in), not defended against after the
fact.

## Guardrails not otherwise addressed above

- "Maintain a record of insights and allow users to undo changes" — not
  applicable to this story's UI-layer scope.
- "Verify significant drops or increases in KPIs before sending alerts" —
  already built, separately, in STORY-012.
- "Ensure data accuracy and integrity throughout the process" — the
  upload form doesn't change what `uploadRoute.ts` already guarantees
  (dedup, validation); it's a new door into the same, already-correct
  pipeline, not a new pipeline.

## Verification (to be filled in as the walking skeleton lands)

- `UploadForm.test.tsx`: selecting a file then clicking Upload is exactly
  two user actions to a result; success re-triggers the dashboard load;
  failure shows a plain-language message, not a raw error; the file input
  is properly labeled.
- `uploadApi.test.ts`: same retry/timeout/terminal-error shape proof
  `kpiApi.test.ts`/`feedbackApi.test.ts` already established.
- `uiInteractionRoute.test.ts`: `POST /api/ui/interactions` logs the
  event with a timestamp; a malformed body doesn't crash the endpoint.
- `satisfactionService.test.ts`: fewer than 2 check-ins → `insufficient_data`;
  a synthetic sequence where later ratings average higher than earlier ones
  → `increased`; lower → `decreased`; equal → `flat`; every check-in logs a
  Trust line with a timestamp.
- `satisfactionRoute.test.ts`: `POST /api/satisfaction/checkin` records and
  logs; an invalid rating is a 400, not silently accepted; `GET
  /api/satisfaction/trend` reflects real recorded state, starting at
  `insufficient_data` with nothing recorded — never a fabricated trend.
- `SatisfactionCheckin.test.tsx`: renders three plain-language options;
  clicking one submits the corresponding rating.
- `tsc --noEmit` (backend + frontend) clean; no regressions.
