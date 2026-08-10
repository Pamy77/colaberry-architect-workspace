---
name: data-quality-gate
description: Use when the user asks to validate a dataset, CSV, ETL output, or data feed for quality — or asks whether a dataset, report, or dashboard is ready to publish. Runs schema, freshness, volume, key-uniqueness, required-field, and numeric-rule checks against a quality contract, returning PASS/WARN/FAIL with evidence and a PUBLISH or BLOCK recommendation. Do NOT use for ordinary requests to write or debug SQL, calculate or define a metric, or design a dashboard's layout/charts/visuals — those are not quality-gate requests even when they mention a dataset or dashboard by name.
---

# Data Quality Gate

## When to trigger

Trigger only when the request is specifically about **validating data correctness or publish-readiness** — e.g. "validate this dataset," "is this CSV ready to publish," "check this ETL output for quality issues," "can this go to the dashboard."

Do **not** trigger on requests that merely touch data or dashboards without asking for validation:
- Writing, debugging, or optimizing a SQL query
- Calculating, defining, or explaining a metric
- Designing, building, or styling a dashboard or chart

If unsure whether a request is asking for validation vs. one of the above, look for an explicit ask to check/validate/verify readiness. Absent that, don't invoke.

## Inputs

1. **Dataset path** — required. If the user has not given one, ask for it before doing anything else. Do not guess a path.
2. **Quality contract** — if the user supplies a contract file or inline rules, use it as the source of truth for thresholds and required fields. If no contract is supplied, fall back to the default checks in `references/quality-checks.md` using reasonable, stated assumptions, and note in the report that no contract was provided.

## Procedure

1. Read the dataset and the quality contract (if any). Do not modify either file.
2. Read `references/quality-checks.md` before running checks — it defines exactly what each check verifies, what counts as evidence, and the default assumptions to use when the contract is silent on a check. Read it once per session; no need to reread it if already loaded earlier in this conversation.
3. Run the checks defined there (schema, freshness, expected volume, key uniqueness, duplicates, required fields, nulls, numeric rules), using the contract's thresholds where it defines them.
4. For each check, record: what was checked, the evidence (counts, row references, sample values), and a status.
5. Never modify the source dataset. This skill is read-only with respect to the data being validated.

## Output format

Return a table with these columns:

| Check | Evidence | Status | Recommended Action |
|---|---|---|---|

Status per check is PASS, WARN, or FAIL.

After the table:

- State the overall result as one of **PASS**, **WARN**, or **FAIL** (worst individual check status wins, unless the contract says otherwise).
- State a final recommendation: **PUBLISH** or **BLOCK**. Any FAIL blocks publication. Multiple WARNs or an unresolved freshness/volume issue should also lean BLOCK — use judgment and state the reasoning in one line.

Keep the report concise and procedural — evidence-driven, not narrative.
