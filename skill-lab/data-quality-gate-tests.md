# data-quality-gate — Trigger Tests

Manual trigger-reliability tests for the `data-quality-gate` skill (`.claude/skills/data-quality-gate/SKILL.md`). Run each prompt in a fresh session and confirm the skill does/does not fire as expected.

## Should trigger

1. **"Validate skill-lab/orders.csv against skill-lab/quality-contract.md before it feeds the executive revenue dashboard."**
   Explicit dataset validation request with a contract and a publish destination.

2. **"Is this ETL output ready to publish? Here's the file: exports/nightly_load.csv — check it before it goes to the reporting layer."**
   Explicit publish-readiness question about an ETL output.

3. **"Run a data-quality check on customers.csv — I want to know if there are duplicate IDs, missing required fields, or stale rows before we ship it to the dashboard."**
   Explicit quality-check request naming the kinds of checks the skill performs (duplicates, required fields, freshness).

## Should NOT trigger

1. **"Write a SQL query that joins orders and customers and sums revenue by region."**
   Ordinary SQL-writing request. No validation or publish-readiness ask, even though it touches `orders`/`revenue`.

2. **"Calculate the month-over-month growth rate for total revenue from this dataset."**
   Metric calculation/definition request. Uses a dataset but isn't asking to validate it.

3. **"Design a dashboard layout showing revenue by region with a bar chart and a trend line — what should the color palette and grid look like?"**
   Dashboard design/visual-layout request. Mentions "dashboard" but is about presentation, not data quality or publish-readiness.

## Expected output requirements (when triggered)

- A markdown table with columns: `Check | Evidence | Status | Recommended Action`.
- One row per check: schema, freshness, expected volume, key uniqueness, duplicates, required fields, nulls, numeric rules (as applicable to the dataset/contract).
- Each `Status` value is exactly one of `PASS`, `WARN`, or `FAIL`.
- Evidence is concrete (row/line references, counts, or sample values) — not narrative description.
- An explicit **overall result** line: `PASS`, `WARN`, or `FAIL`, equal to the worst individual check status unless the contract states otherwise.
- An explicit **recommendation** line: `PUBLISH` or `BLOCK`, with one line of reasoning.
- The source dataset file is not modified.
- If no quality contract is supplied, the report states that fact and lists the default assumptions used (see `references/quality-checks.md`).
