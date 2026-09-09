# CLAUDE.md — Sales Forecasting Tool (Sample Project Standards)

This document defines the coding conventions, naming standards, and documentation guidelines for the **Sales Forecasting Tool** sample project. It is a teaching/reference example — follow it the same way a team would follow a real project's contribution guide.

---

## 1. Project Overview

The Sales Forecasting Tool is a sample application that ingests historical sales data, applies forecasting models (e.g., moving average, ARIMA, or regression-based methods), and outputs predicted sales figures for upcoming periods. It typically consists of a data ingestion layer, a forecasting/modeling layer, and a reporting/output layer (CLI, API, or dashboard).

---

## 2. Coding Conventions

### 2.1 General Principles
- Write code that is simple, readable, and predictable over code that is clever.
- One function should do one thing. If a function forecasts sales *and* formats a report, split it.
- Avoid duplicating logic — if the same calculation appears in more than two places, extract it into a shared function.
- Keep functions short (aim for under ~40 lines); keep files focused on a single responsibility (e.g., `data_loader.py`, `forecast_model.py`, `report_generator.py`).

### 2.2 Style & Formatting
- **Python:** follow PEP 8. Use 4-space indentation, no tabs.
- **JavaScript/TypeScript:** follow a standard style guide (e.g., Airbnb or Prettier defaults). Use 2-space indentation.
- Run a formatter/linter before committing:
  - Python: `black` + `flake8` (or `ruff`)
  - JS/TS: `prettier` + `eslint`
- Line length: keep lines under ~100 characters.
- Use consistent quote style within a language (e.g., single quotes in JS, double quotes in Python strings).

### 2.3 Error Handling
- Never silently swallow errors (no empty `except:` / `catch {}` blocks).
- Catch specific exceptions, not generic ones, where possible (e.g., `except ValueError` rather than bare `except:`).
- Fail loudly during development; log clearly and handle gracefully in production paths (e.g., malformed input data should raise a clear validation error, not crash the whole pipeline).
- Validate external inputs (uploaded CSVs, API payloads) before they reach forecasting logic.

### 2.4 Example (Python)

```python
def calculate_moving_average(sales: list[float], window: int) -> float:
    """Return the moving average of the last `window` sales values."""
    if window <= 0:
        raise ValueError("window must be a positive integer")
    if len(sales) < window:
        raise ValueError("not enough data points for the given window")

    return sum(sales[-window:]) / window
```

---

## 3. Naming Standards

| Element | Convention | Example |
|---|---|---|
| Variables | `snake_case` (Python) / `camelCase` (JS/TS) | `monthly_sales`, `monthlySales` |
| Functions | `snake_case` (Python) / `camelCase` (JS/TS), verb-first | `calculate_forecast()`, `loadSalesData()` |
| Classes | `PascalCase` | `SalesForecastModel` |
| Constants | `UPPER_SNAKE_CASE` | `DEFAULT_FORECAST_WINDOW = 12` |
| Files | `snake_case.py` / `kebab-case.ts` matching primary export | `forecast_model.py`, `sales-report.ts` |
| Folders | lowercase, purpose-based | `data/`, `models/`, `reports/`, `tests/` |
| Branches | `type/short-description` | `feature/arima-model`, `fix/csv-parser-bug` |
| Commits | imperative mood, present tense | `Add ARIMA forecasting module` (not "Added" or "Adding") |

### Naming Rules of Thumb
- Names should describe **what**, not **how** (`get_active_customers()` not `loop_and_filter_customers()`).
- Avoid abbreviations unless they are domain-standard (`qty`, `avg` are fine; `slsFcst` is not).
- Boolean variables/functions should read as a yes/no question: `is_valid`, `has_forecast_data`, `should_retrain_model`.
- Avoid generic names like `data`, `temp`, `result` unless scope is trivially small (e.g., inside a 3-line function).

---

## 4. Documentation Guidelines

### 4.1 Code-Level Documentation
- Every public function/class gets a short docstring (or JSDoc block) explaining **purpose**, **parameters**, and **return value** — not a restatement of the code.
- Inline comments are reserved for **why**, not **what**. If the code needs a comment to explain what it does, consider renaming variables/functions instead.

```python
# Using a 3-period lag because sales data has a known reporting delay.
adjusted_period = current_period - 3
```

### 4.2 README Requirements
Every project (and every non-trivial module) should have a `README.md` covering:
1. **Purpose** — what the tool/module does and why it exists
2. **Setup** — install steps, environment variables, dependencies
3. **Usage** — example commands or API calls
4. **Data assumptions** — expected input format (e.g., CSV schema for sales data)
5. **Known limitations** — what the tool does *not* handle yet

### 4.3 Changelog Practices
- Maintain a `CHANGELOG.md` (or equivalent) noting notable changes per release/version.
- Each entry should state **what changed** and **why**, not just "bug fixes."
- Group entries under `Added`, `Changed`, `Fixed`, `Removed` headings.

### 4.4 Documentation Hygiene
- Update documentation in the **same commit/PR** as the code change it describes — stale docs are worse than no docs.
- Remove documentation for deleted features; don't leave dead references.
- Prefer a few accurate, well-maintained docs over many exhaustive, quickly-outdated ones.

---

## 5. Quick-Reference Checklist

Before committing/merging changes to the Sales Forecasting Tool:

- [ ] Code formatted and linted with no warnings
- [ ] Functions/files follow single-responsibility naming and stay reasonably short
- [ ] Names follow the conventions in Section 3
- [ ] Errors are handled explicitly — no silent failures
- [ ] Public functions/classes have docstrings
- [ ] README/CHANGELOG updated if behavior, setup, or usage changed
- [ ] No secrets or credentials committed
- [ ] Tests added or updated for new/changed logic

---

*This is a sample standards document created for a class exercise and is not tied to any specific production system.*
