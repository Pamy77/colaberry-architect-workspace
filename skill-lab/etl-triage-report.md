# ETL Triage Report — orders_pipeline_daily

**Run investigated:** `orders_pipeline_daily-20260803-100000`
**Sources:** `skill-lab/orders-pipeline-failure.log`, `skill-lab/pipeline-run-metadata.md`
**Constraints honored:** pipeline code not modified, job not rerun.

## Incident Summary

`orders_pipeline_daily` (run `-20260803-100000`) failed during the transform phase: row `O1006` could not be resolved by the `region_code_to_region_dim_id_lookup` step because its `region` value is blank, all 3 retry attempts hit the identical error, and the row was routed to dead-letter, marking the job FAILED.

## Evidence

- Extract completed successfully: 12 rows extracted (log line 3, `extract_complete`, `outcome: success`).
- Schema validation flagged `region` as violating the contract's non-null rule for row `O1006`, value `""` (log line 5, `schema_validation_mismatch`, `error_class: ContractViolation`).
- Transform step `region_code_to_region_dim_id_lookup` failed to resolve `O1006` against lookup table `dim_region` for input value `""`, with message *"No matching entry in dim_region for region_code=''. Lookup requires a non-empty key."* (log line 7, `attempt: 1`).
- The identical error, same message, same input value, recurred on `attempt: 2` (log line 11) and `attempt: 3` (log line 13) — no change in outcome across retries.
- After 3 of 3 configured attempts, the row was routed to dead-letter and the run marked FAILED (log line 14, `retries_exhausted`; metadata "Attempts: 3 of 3 (retries exhausted)").
- Run metadata's history table shows this is the first occurrence of this failure in the last 3 recorded runs, and that "the source extract began including a row with a blank `region` value... starting with this run; prior runs' extracts did not contain blank `region` values" (metadata, *Known upstream context*).
- Run metadata confirms `dim_region` was last updated 2026-07-15, unchanged since, and no deploys/config changes to `orders-pipeline` are recorded for 2026-08-03 (metadata, *Known upstream context*).
- Duplicate row `O1005` was skipped via idempotent upsert with no impact on job outcome (log line 8, `insert_conflict_skipped`) — not a cause of failure.
- Row `O1007`'s negative revenue was flagged but did not block the run (log line 15, `value_flagged`, `outcome: partial`) — not a cause of failure.

## Ranked Causes

1. **Source extract delivered a blank `region` value for order `O1006`, which `dim_region` cannot resolve.**
   Evidence: the contract violation and mapping failure both name the same row (`O1006`) and the same empty value (log lines 5, 7); run metadata independently confirms blank `region` is new to this run's extract and wasn't present in prior runs. Neither the lookup table nor the pipeline config changed on 2026-08-03, narrowing the change to the source data itself.

2. **`dim_region` lookup has no fallback/default entry for a missing region code.**
   Evidence: the lookup step requires "a non-empty key" with no observed fallback or default-mapping attempt in the log (log lines 7, 11, 13 all show the same unresolved-key error, never a fallback path). This doesn't explain *why* the value is blank, but it explains why the pipeline had no way to proceed once it received one.

3. **Retry policy does not distinguish deterministic from transient failures.**
   Evidence: the same `MappingError`, same input, same message repeated across attempts 1–3 on a fixed 30s delay (log lines 7, 11, 13) with no change in condition between attempts — a fixed-delay retry cannot resolve a deterministic data problem, so the 3 attempts added ~62s of runtime without any chance of success.

## Next Tests

1. **For Cause 1** — query the upstream system or job that produces `skill-lab/orders.csv` (read-only) to confirm whether `region` is genuinely null/blank at the source for `O1006`, or whether it was dropped in an intermediate extraction step. This determines whether the fix belongs upstream or in this pipeline's extract logic.
2. **For Cause 2** — query the `dim_region` table (read-only `SELECT`) to confirm whether an "unknown"/default catch-all entry exists or was ever intended to exist for unresolved region codes.
3. **For Cause 3** — review the `orders-pipeline` transform step's retry/circuit-breaker configuration (read-only) to confirm whether `MappingError` is currently retried using the same policy as transient errors (e.g. timeouts), rather than being excluded from retry or failing fast.

## Escalation Recommendation

**No escalation required yet** — this looks like a data-quality/config gap (missing source value plus no lookup fallback), which is within normal on-call remit to diagnose and fix once Test 1 confirms where the blank value originates. If Test 1 shows the upstream source system has permanently changed what it sends for `region` (a contract change on their end), that should be escalated per `CLAUDE.md`'s Escalation Protocol as a directive/contract conflict — but that determination requires Test 1's result first, not the current evidence.
