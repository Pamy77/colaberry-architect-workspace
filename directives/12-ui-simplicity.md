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
  **Not built. Documented here as an explicit, permanent gap** — a later
  real UX-research or in-product survey mechanism would be a separate
  story, not something this directive fakes with a fabricated metric.
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
- `tsc --noEmit` (backend + frontend) clean; no regressions.
