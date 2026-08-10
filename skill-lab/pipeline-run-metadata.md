# Run Metadata — orders_pipeline_daily

## Job identity

| Field | Value |
|---|---|
| Pipeline / job name | `orders_pipeline_daily` |
| Run ID | `orders_pipeline_daily-20260803-100000` |
| Owning service | `orders-pipeline` |
| Schedule | `0 10 * * *` (daily, 10:00 UTC) |
| Source | `skill-lab/orders.csv` |
| Target table | `warehouse.fact_orders` |
| Quality contract | `skill-lab/quality-contract.md` |
| Log file | `skill-lab/orders-pipeline-failure.log` |
| Retry policy | fixed delay, 30s, max 3 attempts |

## This run

| Field | Value |
|---|---|
| Started | 2026-08-03T10:00:00.102Z |
| Ended | 2026-08-03T10:01:02.700Z |
| Duration | 62.6s |
| Status | **FAILED** |
| Rows extracted | 12 |
| Rows loaded | 10 |
| Rows deduplicated (idempotent skip) | 1 (`O1005`) |
| Rows dead-lettered | 1 (`O1006`) |
| Failing step | `region_code_to_region_dim_id_lookup` (transform phase) |
| Attempts | 3 of 3 (retries exhausted) |

## Recent run history

| Run date | Status | Rows extracted | Rows loaded | Rows dead-lettered | Notes |
|---|---|---|---|---|---|
| 2026-08-01 | SUCCESS | 9 | 9 | 0 | — |
| 2026-08-02 | SUCCESS | 10 | 10 | 0 | — |
| 2026-08-03 | **FAILED** | 12 | 10 | 1 | First failure of `region_code_to_region_dim_id_lookup` on `dim_region`; no prior occurrence in the last 7 runs. |

## Known upstream context

- `dim_region` lookup table was last updated 2026-07-15 and has not changed since.
- The source extract (`skill-lab/orders.csv`) began including a row with a blank `region` value (`O1006`) starting with this run; prior runs' extracts did not contain blank `region` values.
- No deploys or config changes to `orders-pipeline` are recorded for 2026-08-03.

## Escalation contact

Per `CLAUDE.md`, escalations route to the DRI: Ali Muwwakkil (`ali@colaberry.com`).
