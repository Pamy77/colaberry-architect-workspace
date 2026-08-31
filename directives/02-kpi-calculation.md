# Directive 02: KPI Calculation (STORY-002)

## Goal

Turn the cleaned output of the upload pipeline into KPIs the caller can display,
with an explicit evidence level on every number and an explicit list of
questions to put back to the user when the data is incomplete — rather than
returning a confident-looking but unsupported figure.

## Inputs

- `CleaningResult` from `backend/src/services/dataCleaningService.ts`
  (`headers`, `cleanedRows`, `flaggedRows`, `totalDataRows`)
- `backend/src/services/kpiService.ts` — `calculateKpis(result)` and
  `logKpiCalculation(calc, context)`
- `KPI_HIGH_EVIDENCE_MIN` / `KPI_MEDIUM_EVIDENCE_MIN` — coverage thresholds,
  env-configurable, defaults 0.99 / 0.75

## Outputs

- `KpiCalculation` — `{ status, kpis[], clarificationsNeeded[], summary }`
  (plain TS interface in `kpiService.ts`)
- `KpiResultSchema` in `backend/src/routes/uploadContract.ts` — the runtime
  (Zod) contract for the same shape, attached to `UploadSuccessResponseSchema`
  as `kpis`. A compile-time `AssertMutual<KpiResult, KpiCalculation>` guard in
  that file fails the build if the two representations drift apart.
- `POST /api/upload` success response now carries a `kpis` block alongside
  `cleaning`.
- Structured JSON log line: `kpi_calculation` event (`outcome: success` when
  `status === 'ok'`, `partial` when `needs_clarification`), including a
  per-KPI `evidence: [{ key, evidenceLevel }]` array and the list of
  `clarificationCodes`. This is the STORY-002 audit-trail requirement
  ("the system logs KPI calculations and evidence levels").

## What gets calculated

- **Per numeric column** (any column with >= 1 parseable numeric value):
  `column.<header>.total` (sum) and `column.<header>.average` (mean).
- **Derived business KPIs**, only when the named input columns are present
  (header match, case/punctuation-insensitive):
  - revenue synonyms: revenue, sales, income, turnover
  - expense synonyms: expenses, expense, costs, cost, spend, expenditure
  - `business.revenue.total`, `business.expenses.total`,
    `business.profit.gross` (revenue - expenses),
    `business.margin.gross` (profit / revenue).
- A numeric-looking column that also carries a currency KPI (e.g. `revenue`)
  intentionally appears twice: once as the generic `column.revenue.total`
  (`unit: number`) and once as `business.revenue.total` (`unit: currency`).
  Keys are unique; this is by design, not a bug.

## Evidence model

`coverage = rowsUsed / rowsConsidered`, where `rowsConsidered` is every
non-empty data row (cleaned + flagged) and `rowsUsed` is how many carried a
parseable numeric value for that column.

| coverage | evidenceLevel |
|---|---|
| >= `KPI_HIGH_EVIDENCE_MIN` (0.99) | `high` |
| >= `KPI_MEDIUM_EVIDENCE_MIN` (0.75) | `medium` |
| > 0 | `low` |

Derived KPIs take the weaker evidence level of their inputs.

## Edge cases

- No non-empty data rows → `status: needs_clarification`, `kpis: []`,
  clarification `no_data`.
- No column has any numeric value → `needs_clarification`, `kpis: []`,
  clarification `no_numeric_columns`.
- A column mixes numbers and text → non-numeric cells are skipped (not
  guessed, not zeroed), clarification `inconsistent_column`.
- A column's coverage is below `KPI_MEDIUM_EVIDENCE_MIN` → the KPI is still
  returned, marked `low` evidence, plus clarification `low_coverage`.
- Revenue column present but no expenses column → revenue total is returned,
  profit/margin are not, clarification `missing_kpi_inputs`.
- Total revenue is zero → gross margin is not emitted (no divide-by-zero),
  clarification `missing_kpi_inputs`; gross profit is still returned.
- `needs_clarification` is **not** an HTTP error — `POST /api/upload` returns
  200 with the partial KPIs and the questions. The upload succeeded; the
  system is asking, not rejecting.

## Failure modes handled vs not handled

Handled: data inconsistency (mixed column), calculation error (empty input,
divide-by-zero), missing data (empty/flagged cells lowering coverage). An
unexpected throw from `calculateKpis` in the route is caught, logged as a
`kpi_calculation` failure line, and routed to the generic 500 path.

Not handled (documented limitation in `parseNumeric`): accounting-style
`(100)` negatives, trailing `%`, and non-US decimal separators — those cells
count as non-numeric.

## Safety constraints

- No domain KPI is invented from data the file does not contain; when an
  input is missing the system asks rather than assumes (project guardrail:
  "ensure data accuracy and integrity throughout").
- Thresholds stay env-configurable, never hardcoded past this file's
  documented defaults.
- KPI calculation runs in-process in the request handler, inheriting the
  same synchronous-work coupling documented in `01-upload-cleaning-service.md`.
  It is O(rows x columns) with no I/O, so it is far cheaper than the parse
  step that precedes it; the revisit trigger is the same one — move the whole
  cleaning+KPI stage to a background job if real usage approaches the row cap.

## Verification

- `backend/src/services/kpiService.test.ts` — happy path, unique keys,
  generic-column-only, missing-data / inconsistency / no-data failure paths,
  divide-by-zero guard, revenue-without-expenses, evidence-level boundaries,
  currency parsing, both `logKpiCalculation` branches.
- `backend/src/routes/uploadRoute.test.ts` — KPI happy path through the real
  endpoint (with an assertion that the audit line carries evidence levels),
  and incomplete data returning 200 + `clarificationsNeeded`.
- `tsc --noEmit` clean (includes the `AssertMutual` contract guard).
