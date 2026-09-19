# Directive 10: Detailed Reports for Analysts (STORY-013)

## Goal

Generate a detailed report combining every existing data domain — KPI
calculations, synced financial records, and decisions made — so an
analyst can do in-depth review from one place. Satisfies REQ-016 (FUNC,
must) — "provide detailed reports for teams of analysts."

## Confirmed with the project owner before building (2026-09-19)

Neither "report template" nor "using available data sources" existed as a
concept in this codebase before this story. Confirmed design:

- **One template for the walking skeleton**: `templateId: 'full_detail'`,
  combining all three existing sources. Room to add more templates later
  without redesigning the contract; requesting any other id is the
  **Report template error** failure path.
- **Parameters**: an optional `sources` filter (default: all three) — this
  is what gives the Trust criterion's "logged with the parameters used"
  actual content, since STORY-008's summary report took no parameters at
  all.
- **No files outside this story need to change.** Unlike STORY-006/008,
  the three sources this report reads (`latestKpiStore.ts`,
  `financialRecordStore.ts`, `decisionLog.ts`) already expose plain read
  functions; nothing needs new recording logic wired into it.
- **Two distinct failure paths, mapped separately, matching the brief's
  own distinction:**
  - **Data source unavailability** = a technical failure reading a store
    (defensive try/catch at the route layer, typed 502 — same shape as
    `dashboardRoute.ts`'s `DashboardUnavailable` / STORY-008's
    `ReportUnavailable`; currently unreachable since every read here is
    synchronous and in-memory, but present for the same reason those are).
  - **Incomplete data** = a requested source currently has nothing in it
    (never calculated / never synced / nothing decided yet) — not an
    error, a `status: 'incomplete'` response naming exactly which sources
    are missing (acceptance #2).
- **Logging failure**, new here (STORY-008 didn't have this failure
  path): the audit log call is unconditional — it fires on every code
  path (`ok`, `incomplete`, `invalid_template`, and the route's technical
  failure branch), not just the happy path, so nothing can happen without
  a log line.

## Inputs (new, this story)

- `backend/src/services/detailedReportService.ts` —
  `generateDetailedReport(params)`: reads the three existing sources,
  assembles the report, determines `missingDataSources`.
- `backend/src/routes/detailedReportRoute.ts` / `detailedReportContract.ts`
  — `GET /api/reports/detailed?sources=kpis,financial,decisions&templateId=full_detail`,
  zod-validated, query-string params (still a pure read, so `GET`, not
  `POST` — consistent with `reportRoute.ts`'s STORY-008 pattern, extended
  with query params since this read takes parameters and that one didn't).

No changes to `latestKpiStore.ts`, `financialRecordStore.ts`, or
`decisionLog.ts` — read-only reuse of their existing exports
(`getLatest`, `listRecords`, `listDecisions`).

## What "a detailed report... with all relevant metrics" means

```
DataSourceName = 'kpis' | 'financial' | 'decisions'
ReportTemplateId = 'full_detail'

DetailedReport = {
  status: 'ok' | 'incomplete';
  templateId: string;                 // echoes what was requested, even if invalid
  generatedAt: string;
  correlationId: string;
  sourcesRequested: DataSourceName[];
  missingDataSources: DataSourceName[];
  kpis: { filename, generatedAt, result: KpiCalculation } | null;
  financial: { records: SyncRecord[], recordCount: number } | null;
  decisions: { entries: DecisionEntry[], decisionCount: number } | null;
}
```

Each requested source's section is populated in full (the whole
`KpiCalculation` — every KPI with its evidence level, every clarification
— not a summary of it; every synced financial record; every decision) —
"detailed" means nothing is trimmed or paraphrased, unlike STORY-008's
summary report.

## What "missing data" / "incomplete" means (acceptance #2)

A requested source is **missing** when it has never produced anything at
all: `kpis` — `getLatest()` returns `null` (no calculation has ever run);
`financial` — `listRecords()` is empty (nothing has ever synced);
`decisions` — `listDecisions()` is empty (nothing has been decided yet).
This is a uniform rule applied the same way to all three sources, even
though "zero decisions so far" is a softer kind of absence than "no
calculation has ever run" — documented interpretation, not a silent
inconsistency.

`status` is `'incomplete'` if **any** requested source is missing, not
only when all of them are — a report an analyst asked for that's silently
missing one of three sections would be exactly the kind of thing this
criterion exists to prevent.

## Report template error

`templateId` is validated first, before touching any data source (fail
fast on bad input, same order `subscriptionService.selectPlan` validates
`planId` before any store access). An unrecognized `templateId` returns
`status: 'invalid_template'` immediately — `sourcesRequested`,
`missingDataSources`, and every section are empty/null, since nothing was
read.

## Outputs

- `GET /api/reports/detailed` → the `DetailedReport` above, `200` for
  `ok`/`incomplete`, `400` for `invalid_template`, `502`
  `DataSourceUnavailable` if an unexpected read failure occurs.
- `X-Correlation-ID` header, same id as the report body's
  `correlationId` — the same "one id, not two" fix already made once this
  session in `syncRoute.ts` and `reportRoute.ts`.
- A `detailed_report_generated` structured log line on **every** call —
  Trust criterion, "logged with the parameters used and timestamp":
  carries `templateId`, `sourcesRequested`, `status`, and
  `missingDataSources`.

## Idempotency

A pure read, same as STORY-008's summary report — generating the same
report twice with the same parameters and no data changes in between
returns identical content. Nothing here needs its own idempotency key.

## Failure paths

Handled (all five required): **Incomplete data** (`status: 'incomplete'`
+ `missingDataSources`, see above); **Report template error**
(`status: 'invalid_template'`, validated before any data access);
**Data source unavailability** (route-level try/catch, `502`, same
defensive shape as `dashboardRoute.ts`/`reportRoute.ts`); **Incorrect
report metrics** (`recordCount`/`decisionCount` are asserted to exactly
equal their array lengths in tests, not eyeballed — same guard STORY-008
used); **Logging failure** (the log call is unconditional across every
branch, including the route's catch block, tested explicitly on each
path).

## Guardrails not otherwise addressed above

- "Maintain a record of insights and allow users to undo changes" — this
  report reads existing records; it does not create a new kind of record
  and has no undo action (STORY-014's job).
- "Verify significant drops or increases in KPIs before sending alerts" —
  not applicable; this story doesn't send alerts.
- "Ensure data accuracy and integrity throughout the process" — the
  incorrect-report-metrics guard above is this guardrail in action:
  refusing to report a count that doesn't match what's actually there.

## Verification (to be filled in as the walking skeleton lands)

- `detailedReportService.test.ts`: all three sources present → `ok` with
  every section populated and every count correct; one source missing →
  `incomplete` naming exactly that source; all three missing → `incomplete`
  naming all three; an unrecognized `templateId` → `invalid_template`
  with no data touched; the log line fires on every one of those paths.
- `detailedReportRoute.test.ts`: `GET /api/reports/detailed` contract-valid
  response for `ok`/`incomplete`/`invalid_template` (400) status codes,
  correlation id header matches body, `sources` query param actually
  narrows which sections are populated.
- `tsc --noEmit` clean; no regressions in the existing suite.
