# ETL Failure Triage — orders_pipeline_daily

**Run ID:** `orders_pipeline_daily-20260803-100000`
**Log:** `skill-lab/orders-pipeline-failure.log`
**Metadata:** `skill-lab/pipeline-run-metadata.md`

## Incident Summary

The `orders_pipeline_daily` job (schedule `0 10 * * *`) run on 2026-08-03T10:00:00Z ended in status **FAILED** after 62.6s. It extracted 12 rows, loaded 10, deduplicated 1 (`O1005`), and dead-lettered 1 (`O1006`) after exhausting retries on a region-lookup mapping step.

## Evidence

- Extract completed successfully: 12 rows extracted, max `load_timestamp` `2026-08-03T09:30:00Z` (log line `extract_complete`).
- Schema validation flagged `region` as blank for `O1006` (`schema_validation_mismatch`, `ContractViolation`, `rows_affected:1`, `row_ids:["O1006"]`, `sample_value:""`).
- Transform step `region_code_to_region_dim_id_lookup` failed for `O1006` with `error_class:MappingError`: *"No matching entry in dim_region for region_code=''. Lookup requires a non-empty key."* — repeated identically across attempts 1, 2, and 3 (log lines `mapping_lookup_failed` at 10:00:02.115Z, 10:00:32.360Z, 10:01:02.590Z).
- After 3/3 attempts (`retry_policy: fixed_delay`, `max_attempts: 3`), `retries_exhausted` fired and `O1006` was routed to `dlq.orders_pipeline_failures`.
- `job_end` explicitly attributes the FAILED status to the unresolved dead-letter row: *"Job marked FAILED due to unresolved dead-letter row."* (`error_class: MappingError`).
- Duplicate `order_id O1005` (source line 13) was handled by an idempotent upsert: `insert_conflict_skipped`, `ON CONFLICT (order_id) DO NOTHING applied, no duplicate row inserted`, `occurrences_in_batch: 2`. This did **not** contribute to the FAILED status.
- Negative revenue on `O1007` (`value_flagged`, `value: -42.00`) was logged as a warning only: *"no hard constraint configured on this field; loaded as-is to fact_orders... did not block the run."*
- Run metadata: `dim_region` lookup table last changed 2026-07-15, unchanged since. No deploys/config changes to `orders-pipeline` recorded for 2026-08-03.
- Run metadata: *"The source extract began including a row with a blank `region` value (`O1006`) starting with this run; prior runs' extracts did not contain blank `region` values."*
- Run history: 2026-08-01 and 2026-08-02 both SUCCEEDED with 0 dead-lettered rows; 2026-08-03 is the first occurrence of this mapping failure in the last 7 runs.

## Ranked Causes

1. **Source extract began delivering a blank `region` value for `O1006`, which the `region_code_to_region_dim_id_lookup` step cannot resolve against `dim_region` (which requires a non-empty key).** This is the direct and sole cause of the job's FAILED status. Evidence: `schema_validation_mismatch` + 3x identical `mapping_lookup_failed` (line 5, lines 7/11/13) + `retries_exhausted` + `job_end` summary explicitly naming the dead-letter row as the failure cause; corroborated by run metadata noting this is a new condition absent from the prior 7 runs, with no change to `dim_region` or to the pipeline itself.
2. **No hard numeric constraint is configured on `revenue`, allowing the negative value on `O1007` to load without blocking the run.** Not the cause of the FAILED status (the log explicitly says it "did not block the run"), but a contract/validation gap: the quality contract requires `revenue > 0`, yet the pipeline only flags violations rather than enforcing them. Evidence: `value_flagged` log line, explicit note `"no hard constraint configured on this field"`.
3. **Duplicate `order_id O1005` in the source extract.** Confirmed handled correctly and idempotently — not a failure cause, listed for completeness since it was part of the original data-quality findings. Evidence: `insert_conflict_skipped` with `ON CONFLICT DO NOTHING`.

## Next Tests

1. For cause 1 (blank region on `O1006`): check the upstream order-capture system for whether `region` was populated at the point of order creation, to determine whether this is an extraction bug or a genuine gap at the source. (Read-only: inspect the source record for `O1006` in the upstream system, do not modify `dim_region` or the pipeline.)
2. For cause 2 (missing revenue constraint): check the pipeline's transform/validation config to confirm no `revenue > 0` rule was ever implemented, and inspect the source record for `O1007` to determine whether `-42.00` represents a refund/return miscoded as a standard order. (Read-only inspection only.)
3. For cause 3 (duplicate `O1005`): query the upstream source system for order `O1005` to confirm whether the duplicate line is a genuine re-send/retry artifact rather than a key-reuse bug. (Read-only; no pipeline changes — idempotency already prevented any duplicate write.)

## Escalation Recommendation

**No escalation required under the CLAUDE.md Escalation Protocol at this time.** The failure is a data-quality/mapping issue (unmapped blank region value) and a validation-rule gap (missing revenue constraint), not a schema redesign, external dependency, compliance/security boundary, or production infrastructure change. It is resolvable by the on-call engineer / data steward: confirm the source gap for `O1006` (Next Test 1) and decide whether to backfill, default, or explicitly reject the row, and separately decide whether to add a hard `revenue > 0` constraint to the pipeline's transform step. If the source-system investigation reveals a broader upstream data contract change, escalate at that point per the Directive Conflict trigger.
