"""Unit tests for kpi_analysis — the deterministic half of assess_monthly_risk.

Dependency-free: run with `uv run python test_kpi_analysis.py`. Exits non-zero on
the first failed assertion.
"""

from kpi_analysis import (
    build_digest_text,
    prior_month,
    render_rule_based_brief,
    summarize_period,
)

# A small fixture: two months, four KPIs, covering the cases that matter.
READINGS = [
    # Churn: below target and worsening hard (+37.1% MoM, lower_is_better) -> high
    {"kpi_name": "Customer Churn Rate", "period": "2026-06", "current_value": 6.2,
     "target_value": 5.0, "previous_value": 5.8, "unit": "%", "direction": "lower_is_better"},
    {"kpi_name": "Customer Churn Rate", "period": "2026-07", "current_value": 8.5,
     "target_value": 5.0, "previous_value": 6.2, "unit": "%", "direction": "lower_is_better"},
    # Revenue: above target, improving -> low
    {"kpi_name": "Monthly Revenue", "period": "2026-06", "current_value": 47000,
     "target_value": 50000, "previous_value": 45000, "unit": "$", "direction": "higher_is_better"},
    {"kpi_name": "Monthly Revenue", "period": "2026-07", "current_value": 52000,
     "target_value": 50000, "previous_value": 47000, "unit": "$", "direction": "higher_is_better"},
    # Feature adoption: no target, has prior -> not "unknown", but no target gap
    {"kpi_name": "New Feature Adoption Rate", "period": "2026-06", "current_value": 12,
     "target_value": None, "previous_value": None, "unit": "%", "direction": "higher_is_better"},
    {"kpi_name": "New Feature Adoption Rate", "period": "2026-07", "current_value": 15,
     "target_value": None, "previous_value": 12, "unit": "%", "direction": "higher_is_better"},
    # Trial signups: only appears in 2026-07, no target, no prior -> "unknown"
    {"kpi_name": "Trial Signups", "period": "2026-07", "current_value": 30,
     "target_value": None, "previous_value": None, "unit": "", "direction": "higher_is_better"},
    # Zero-baseline KPI: prior value 0 -> percent_change must be None, no crash
    {"kpi_name": "Refund Count", "period": "2026-06", "current_value": 0,
     "target_value": 0, "previous_value": 0, "unit": "", "direction": "lower_is_better"},
    {"kpi_name": "Refund Count", "period": "2026-07", "current_value": 4,
     "target_value": 0, "previous_value": 0, "unit": "", "direction": "lower_is_better"},
]

checks = 0


def check(label, cond):
    global checks
    checks += 1
    if not cond:
        raise AssertionError(f"FAILED: {label}")
    print(f"  ok  {label}")


def by_name(summary, name):
    return next(r for r in summary["kpis"] if r["kpi_name"] == name)


# --- prior_month ------------------------------------------------------------
check("prior_month mid-year", prior_month("2026-07") == "2026-06")
check("prior_month January rolls back the year", prior_month("2026-01") == "2025-12")

# --- summarize_period happy path -----------------------------------------
s = summarize_period(READINGS, "2026-07")
check("all five KPIs with a 2026-07 reading are digested", s["kpi_count"] == 5)
check("baseline period is 2026-06", s["baseline_period"] == "2026-06")

churn = by_name(s, "Customer Churn Rate")
check("churn MoM percent is +37.1", churn["percent_change"] == 37.1)
check("churn is below target", churn["meets_target"] is False)
check("churn trend is worsening", churn["trend"] == "worsening")
check("churn severity is high", churn["severity"] == "high")

rev = by_name(s, "Monthly Revenue")
check("revenue meets target", rev["meets_target"] is True)
check("revenue trend improving", rev["trend"] == "improving")
check("revenue severity is low", rev["severity"] == "low")

# --- boundary: no target, no prior -> unknown ---------------------------
trial = by_name(s, "Trial Signups")
check("trial signups severity is unknown", trial["severity"] == "unknown")
check("trial signups percent_change is None", trial["percent_change"] is None)

# --- boundary: zero baseline -> percent_change None, no ZeroDivisionError
refund = by_name(s, "Refund Count")
check("zero-baseline percent_change is None", refund["percent_change"] is None)
check("zero-baseline absolute_change still computed", refund["absolute_change"] == 4)

# --- rollup + ordering --------------------------------------------------
check("period risk_level rolls up to high", s["risk_level"] == "high")
check("worst KPI sorts first", s["kpis"][0]["kpi_name"] == "Customer Churn Rate")

# --- empty period -------------------------------------------------------
empty = summarize_period(READINGS, "2026-01")
check("unknown month yields zero KPIs", empty["kpi_count"] == 0)
check("empty period risk_level defaults to low", empty["risk_level"] == "low")

# --- digest + fallback text are non-empty and mention the KPIs --------
digest = build_digest_text(s)
check("digest names the worst KPI", "Customer Churn Rate" in digest)
check("digest spells out MoM % so the model need not compute it", "+37.1%" in digest)

brief = render_rule_based_brief(s, "client does not support MCP sampling")
check("fallback brief is non-empty", len(brief.strip()) > 0)
check("fallback brief states the reason", "does not support MCP sampling" in brief)
check("fallback brief flags the high-severity KPI", "Customer Churn Rate" in brief)
check("fallback brief states overall risk", "Overall risk: HIGH" in brief)

calm = render_rule_based_brief(empty, "sampling refused")
check("fallback brief is never blank even with nothing wrong", "Nothing" in calm)

print(f"\nall {checks} checks passed")
