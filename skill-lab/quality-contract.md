# Quality Contract — orders.csv

Contract for validating `skill-lab/orders.csv` before it feeds the executive revenue dashboard.

## Rules

| Field / Check | Rule |
|---|---|
| `order_id` | Must be unique across all rows (business key). |
| `region` | Required — no missing/empty values. |
| `revenue` | Must be greater than 0. |
| `load_timestamp` | Must be less than 24 hours old at validation time. |
| Row count | Expected at least 10 rows. |

## Notes

- A row failing any rule above should be treated as a data-quality defect, not silently dropped.
- This contract covers the fields above only; other columns (`customer_name`, `product`, `quantity`, `order_date`) are informational and not subject to a hard rule here.
