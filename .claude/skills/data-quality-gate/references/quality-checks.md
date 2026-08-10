# Quality Checks Reference

Detailed definitions for each check run by the `data-quality-gate` skill. Read this before running checks; it's the source of truth for what counts as evidence and what to assume when the quality contract is silent on a given check.

## Schema

**What it verifies:** the expected columns are present and each column's values are consistent with the expected type (numeric fields parse as numbers, date/timestamp fields parse as valid dates, etc.).

**Evidence:** the header row (or column list) compared against the contract's expected columns; note any missing, extra, or mistyped columns.

**No contract default:** infer the expected schema from the dataset's own header row and flag only structural problems (e.g. a column that's supposed to be numeric but contains text).

## Freshness

**What it verifies:** the dataset is current enough to be trusted. Compare the **most recent** `load_timestamp` (or equivalent ingestion/update timestamp column) against the contract's max-age threshold.

**Evidence:** the max timestamp value found, the validation time, and the computed age.

**Note:** freshness is evaluated on the most recent timestamp in the dataset, not on every row individually. Older rows are expected in a growing dataset; they are not, by themselves, a freshness defect.

**No contract default:** assume a 24-hour max age and state that assumption in the report.

## Expected volume

**What it verifies:** row count meets the contract's minimum/expected count, catching silently truncated or partial loads.

**Evidence:** the actual row count vs. the contract's stated minimum or expected count.

**No contract default:** flag only if the row count looks implausibly small (e.g. 0 or 1 row) and state that no volume threshold was supplied.

## Key uniqueness

**What it verifies:** the primary/business key column (e.g. `order_id`) has no duplicate values.

**Evidence:** list the duplicated key value(s) and the row locations (line numbers or row indices) where they occur.

**No contract default:** infer the business key from context (an `*_id` column, or a column the contract references) and note the assumption.

## Duplicates

**What it verifies:** full-row or near-duplicate records — distinct from key uniqueness, since a full-row duplicate confirms a true repeated record rather than a reused key with different data.

**Evidence:** the row locations of the duplicate(s) and confirmation of which fields matched (all fields for a full-row duplicate; specify which fields for a near-duplicate).

## Required fields

**What it verifies:** every contract-required column is non-empty on every row.

**Evidence:** the row location(s) and column name(s) where a required field is missing or empty.

## Nulls

**What it verifies:** unexpected nulls/blanks in columns the contract does *not* mark as required — reported for visibility, not necessarily a failing condition.

**Evidence:** column name and count of null/blank values found. This check typically reports PASS with a note, or WARN if the volume of nulls looks concerning, rarely FAIL on its own.

## Numeric rules

**What it verifies:** any contract-defined numeric constraint (e.g. `revenue > 0`, `quantity >= 1`) is satisfied on every row.

**Evidence:** the row location(s), the offending value, and the specific rule violated.

## Status assignment

- **PASS** — check fully satisfied, no exceptions found.
- **WARN** — a minor or ambiguous issue that doesn't clearly violate the contract but is worth flagging (e.g. an unusually high null rate in a non-required column, a borderline freshness value).
- **FAIL** — a clear contract violation: a required field missing, a numeric rule violated, a duplicate key, a dataset older than the max age, or a row count below the stated minimum.

## Overall result and recommendation

- Overall result = the worst individual check status (FAIL beats WARN beats PASS), unless the contract explicitly overrides this.
- Recommendation is **BLOCK** if the overall result is FAIL. Also lean **BLOCK** on multiple WARNs, or on any unresolved freshness/volume issue, even without an outright FAIL — state the reasoning in one line.
- Recommendation is **PUBLISH** only when the overall result is PASS, or a WARN-only result that the report explicitly judges safe to ship with a stated reason.
