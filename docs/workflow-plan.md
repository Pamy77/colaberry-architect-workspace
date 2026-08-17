# Small Business KPI Copilot — Workflow Plan

Same four-stage shape as the inbox triage tool: read a batch of inputs, pull out
structured fields, apply a quality bar, route what fails it to a human, and
produce one finished deliverable from what's left.

## 1. Input — what goes in, and where it lives

- **Cadence:** weekly.
- **Sources today:** a mix of Excel spreadsheets, Google Sheets, CSV exports, and
  QuickBooks reports — not one clean format.
- **Proposed shape:** a single **weekly intake folder** (e.g. `kpi-inputs/2026-W33/`)
  that you drop that week's files into — the QuickBooks export, any bank/POS CSVs,
  and the relevant spreadsheets — before running the copilot. This mirrors the
  `inbox` folder in the triage tool: one place, one week, everything the copilot
  needs to read for that run.

## 2. Structured output — what gets pulled from each week's data

One structured record per week, with these fields:

| Field | What it captures |
|---|---|
| `period_covered` | Which week this run is for |
| `revenue` | Total revenue for the period |
| `expenses` | Total expenses for the period |
| `gross_margin_percent` | Your key ratio |
| `new_customers` | Count of new customers this period |
| `overdue_invoices` | Count and/or total amount of overdue invoices |
| `incomplete_orders` | Count of orders not yet fulfilled/closed |
| `flagged_issues` | Plain-English list of anything that looks off (see below) |
| `one_line_summary` | One sentence: how the week actually went |
| `confidence` | 0–1, how sure the copilot is that these numbers are solid |

## 3. Quality bar — what "good enough" means, and what happens when it isn't

A week gets sent to **your review** instead of being reported as settled if any of
these are true — these are the same things that make you personally double-check
a number today:

- A big jump from last period (e.g., revenue or expenses swings more than a set %)
- A category is missing from one of the source files
- Numbers don't reconcile between sources (e.g., QuickBooks revenue vs. bank CSV
  don't match)
- Gross margin is unusually low
- Data is missing entirely for part of the week
- Confidence comes back below the threshold (mirrors the 0.75 cutoff from triage)

Everything else is **auto-cleared** — folded into the summary with no action needed
from you.

## 4. Deliverable — what comes out the other end

A **one-page weekly summary**, written in plain English (not spreadsheet-speak),
short enough to read on a phone or paste straight into an email to yourself or a
business partner. It contains:

- The week's headline numbers and the one-line summary
- What was auto-cleared vs. what needs your attention, and why
- Any weeks/items that failed to process at all

A running tracker (one row added per week, like `triage_results.csv`) is a natural
next step once the weekly report is working, so you can see trends over time — but
it's not the first deliverable; the one-page summary is.

