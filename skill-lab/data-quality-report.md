# Data Quality Report — orders.csv

**Dataset:** `skill-lab/orders.csv`
**Contract:** `skill-lab/quality-contract.md`
**Validated:** 2026-08-03
**Purpose:** Pre-publication gate for the executive revenue dashboard.

## Checks

| Check | Evidence | Status | Recommended Action |
|---|---|---|---|
| Schema | Header row contains `order_id, customer_name, region, product, quantity, revenue, order_date, load_timestamp` — all 8 expected columns present, types consistent (numeric `quantity`/`revenue`, ISO date/timestamp fields). | PASS | None. |
| Freshness | Most recent `load_timestamp` = `2026-08-03T09:30:00Z` (row 10, `O1009`), validated 2026-08-03. Within contract's 24-hour max age. Note: individual rows range back to `2026-07-31T10:00:00Z` (row 9, `O1008`), but the contract's freshness rule applies to dataset currency, not per-row age. | PASS | None. |
| Expected volume | 12 data rows present. Contract requires ≥ 10. | PASS | None. |
| Key uniqueness (`order_id`) | `O1005` appears twice: line 6 and line 13 (both `Sam Whitfield, US-EAST, Starter Widget, 1, 15.25, 2026-08-02, 2026-08-03T06:30:00Z`). | FAIL | Remove or reconcile the duplicate `O1005` row before publishing; investigate upstream source (e.g. Basecamp/webhook) for a missing idempotency key on ingest. |
| Full-row duplicates | Line 6 and line 13 are exact duplicates in every field (see above) — same defect as the key-uniqueness violation, confirming it's a true duplicate record and not a legitimate re-order with a reused ID. | FAIL | Dedupe on full-row match; keep one instance of `O1005`. |
| Required fields (`region`) | Line 7, `O1006` (Lena Fischer): `region` is empty. | FAIL | Backfill `region` for `O1006` from source system, or exclude the row until resolved. |
| Nulls (informational columns) | No missing values found in `customer_name`, `product`, `quantity`, `order_date`. | PASS | None. |
| Numeric rule (`revenue > 0`) | Line 8, `O1007` (Derek Owusu): `revenue = -42.00`. | FAIL | Investigate — likely a refund/credit or data entry error. Correct or flag as a distinct transaction type; do not feed a negative revenue value into the dashboard's revenue sum unlabeled. |

## Overall Result: **FAIL**

Four defects found: duplicate `order_id`/full-row duplicate (`O1005`), missing required `region` (`O1006`), and a negative `revenue` value violating the numeric rule (`O1007`). Worst individual check status (FAIL) determines the overall result per the contract.

## Recommendation: **BLOCK**

Do not publish to the executive revenue dashboard in current form. A negative revenue value and a duplicated order both directly distort revenue totals shown to executives; the missing region breaks any regional breakdown. Resolve all three FAILs (dedupe `O1005`, backfill or exclude `O1006`, resolve `O1007`'s negative revenue), then re-run this gate before publication.
