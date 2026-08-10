# Data Quality Report — orders.csv

**Dataset:** `skill-lab/orders.csv`
**Contract:** `skill-lab/quality-contract.md`
**Validation time (UTC):** 2026-08-04T01:32:32Z

| Check | Evidence | Status | Recommended Action |
|---|---|---|---|
| Schema | Header row: `order_id,customer_name,region,product,quantity,revenue,order_date,load_timestamp`. All contract-referenced fields present (`order_id`, `region`, `revenue`, `load_timestamp`). Numeric/date columns parse correctly. | PASS | None |
| Freshness | Max `load_timestamp` = `2026-08-03T09:30:00Z` (row 10, order `O1009`). Validation time = `2026-08-04T01:32:32Z`. Age ≈ 16h02m, under the contract's 24h max. | PASS | None |
| Expected volume | 12 total rows / 11 unique `order_id` values. Contract minimum = 10 rows. | PASS | None |
| Key uniqueness | `order_id` `O1005` appears twice — row 6 and row 13 (both `Sam Whitfield`, `US-EAST`, `Starter Widget`, qty 1, revenue 15.25, same timestamps). | FAIL | Deduplicate on `order_id`; investigate source of repeated key before publish. |
| Duplicates | Rows 6 and 13 are full-row duplicates — every field matches exactly for `order_id O1005`. | FAIL | Confirm with upstream source whether this is a re-send/retry artifact; drop one copy once confirmed. |
| Required fields | `region` is blank at row 7 (`order_id O1006`, `Lena Fischer`). | FAIL | Backfill or reject row 7 pending region value; do not silently drop. |
| Nulls | No blank/null values found outside the `region` gap already reported above (required-field check). | PASS | None |
| Numeric rules | `revenue = -42.00` at row 8 (`order_id O1007`, `Derek Owusu`), violates `revenue > 0`. | FAIL | Investigate whether this represents a refund/return miscoded as an order; correct or exclude before publish. |

## Overall Result: **FAIL**

Four contract violations found: duplicate key/full-row duplicate (`O1005`), missing required `region` (`O1006`), and a negative revenue value (`O1007`).

## Recommendation: **BLOCK**

Any single FAIL blocks publication per the quality contract; this dataset has three independent FAIL conditions. Do not publish to the executive revenue dashboard until the duplicate row, missing region, and negative revenue are resolved at the source.
