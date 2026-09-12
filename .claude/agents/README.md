# Subagent definitions

Subagent definitions live here. This file also carries the one worked example of
how the three KPI Copilot pipeline agents — `data-cleaning-agent`,
`kpi-calculator-agent`, `alert-insight-agent` — hand off to each other on a single
task, so the coordination pattern doesn't have to be re-derived from scratch every
time.

## Worked example: walking-skeleton KPI alert

**Task, in one sentence:** Take a raw sample sales file, clean it, compute a
monthly sales-trend KPI with a confidence tag, and draft — but never send — an
alert if that KPI moved enough to matter.

This mirrors the project's real build order (STORY-001 → STORY-002 → STORY-004,
with STORY-007/STORY-012's uncertainty and verification rules folded in) and is
small enough to run as one walking skeleton rather than three separate features.

### Sequence and handoffs

1. **`data-cleaning-agent` runs first.**
   Produces a small, realistic sample sales CSV fixture (a date column, an amount
   column, a few months of data, at least one messy row) and confirms — by
   actually exercising `cleanFile()` against it — that the fixture parses into a
   well-formed `CleaningResult`.
   **Hands off:** the fixture file's path, plus the `CleaningResult` /
   `CleanedRow` / `FlaggedRow` types it already exports from
   `backend/src/services/dataCleaningService.ts`.

2. **`kpi-calculator-agent` runs second.**
   Consumes the fixture and the `CleaningResult` contract from step 1. Builds the
   KPI calculation service (e.g. a monthly sales-trend calculation), and tags the
   computed value with a confidence level (high / medium / low) driven by how much
   of the fixture's data was clean vs. flagged.
   **Hands off:** the typed KPI result (metric name, value, confidence, and the
   evidence behind the confidence call) plus a sample instance of it.

3. **`alert-insight-agent` runs third.**
   Consumes the typed KPI result from step 2. Builds the threshold check
   (did this move enough to matter?) and drafts an alert message — but wires the
   actual send behind a human-approval hold, per REQ-013, rather than firing a
   real email/Slack message. Refuses to draft anything for a low-confidence or
   missing KPI value, since step 2 already decided that number isn't trustworthy.
   **Hands off (to a person, not another agent):** the drafted alert, sitting
   behind the approval hold, for a human to approve or reject.

### Exact request to start it

> Build the walking-skeleton KPI alert path: clean the sample sales fixture,
> compute the monthly sales-trend KPI with a confidence tag, and draft (never
> send) an alert if it moved enough to matter — run data-cleaning-agent, then
> kpi-calculator-agent, then alert-insight-agent in sequence, each handing its
> typed output to the next.

Claude Code does not auto-chain subagents from one request — the main session is
the orchestrator (per this repo's CLAUDE.md: "Orchestration: Decision making,
Claude itself"). It invokes each agent in turn and passes the previous agent's
actual output forward as the next agent's input; it does not run the pipeline's
business logic itself.

### What the finished result looks like

- A committed sample sales fixture under the data-cleaning agent's test tree, with
  a test proving `cleanFile()` handles it.
- A new, tested KPI calculation service that produces a typed `{ value,
  confidence, evidence }` result from that fixture's cleaned output — with a unit
  test covering both a high/medium-confidence path and a low-confidence or
  can't-compute path.
- A new, tested alert-evaluation service that takes that KPI result, applies a
  materiality threshold, and produces a drafted alert object — with the actual
  send gated behind an explicit approval step, and a test proving a low-confidence
  KPI never reaches draft stage.
- `tsc --noEmit` and the full test suite passing after all three stages.
- A `PROGRESS.md` entry for each stage that actually shipped code, each with real
  verification evidence (test output or `tsc` result), not an assumption.
- If any stage stalls — an ambiguous business rule, a missing threshold value, a
  design decision only a human can make — that stage says so explicitly instead of
  guessing, and the chain stops there until answered.
