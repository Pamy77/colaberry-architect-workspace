"""Pure KPI analysis helpers for the monthly risk briefing — no I/O, no MCP.

The `assess_monthly_risk` tool in `server.py` splits into two halves:

  1. the arithmetic — month-over-month change, target gap, a rule-based severity
     per KPI — which is deterministic and lives here, unit-tested on its own;
  2. the judgement — turning that digest into a short owner-facing briefing —
     which is a model call and stays in `server.py` because it needs the MCP
     client session.

`summarize_period` produces the digest. `build_digest_text` renders the compact,
numbers-only view the model is asked to reason over. `render_rule_based_brief`
renders the fallback briefing used when the client cannot run the model step.
"""

from __future__ import annotations

# |month-over-month %| at or above this counts as a "material" move. Matches the
# default threshold in verify_kpi_movement so the two tools speak the same language.
SIGNIFICANT_PCT = 15.0

_SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2, "unknown": 3}
_RANK_TO_RISK = {0: "high", 1: "medium", 2: "low", 3: "low"}


def prior_month(period: str) -> str:
    """'2026-07' -> '2026-06'; '2026-01' -> '2025-12'. Assumes a valid YYYY-MM."""
    year, month = int(period[:4]), int(period[5:7])
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _trend(direction: str, current: float, prior: float | None) -> str | None:
    """'improving' / 'worsening' / 'flat', direction-aware; None with no prior month."""
    if prior is None:
        return None
    if current == prior:
        return "flat"
    improved = current > prior if direction != "lower_is_better" else current < prior
    return "improving" if improved else "worsening"


def _meets_target(direction: str, current: float, target: float | None) -> bool | None:
    """True/False against target, direction-aware; None when no target is set."""
    if target is None:
        return None
    return current >= target if direction != "lower_is_better" else current <= target


def _severity(meets_target: bool | None, trend: str | None, pct_change: float | None) -> str:
    """Rule-based concern level for one KPI. 'unknown' when there is neither a
    target nor a prior month to judge against."""
    if meets_target is None and trend is None:
        return "unknown"
    material = pct_change is not None and abs(pct_change) >= SIGNIFICANT_PCT
    missing = meets_target is False
    worsening = trend == "worsening"
    if missing and worsening:
        return "high" if material else "medium"
    if missing:
        return "medium"
    if worsening:
        return "medium" if material else "low"
    return "low"


def summarize_period(readings: list[dict], period: str) -> dict:
    """Digest every KPI that has a reading in `period`.

    For each: the month-over-month move (vs the same KPI's row for the previous
    calendar month, falling back to its `previous_value` field), whether it meets
    target, its trend, and a rule-based `severity`. Rows are sorted worst-first.
    `risk_level` is the worst per-KPI severity collapsed to high/medium/low.

    Judgement-free: the same readings and period always give the same result.
    """
    base = prior_month(period)
    by_key = {(r["kpi_name"], r["period"]): r for r in readings}
    names = sorted({r["kpi_name"] for r in readings if r["period"] == period})

    rows: list[dict] = []
    for name in names:
        cur = by_key[(name, period)]
        current_value = cur["current_value"]
        direction = cur.get("direction", "higher_is_better")
        unit = cur.get("unit", "")
        target = cur.get("target_value")

        prior_row = by_key.get((name, base))
        prior_value = prior_row["current_value"] if prior_row else cur.get("previous_value")

        if prior_value is None:
            absolute_change = percent_change = None
        else:
            absolute_change = round(current_value - prior_value, 4)
            percent_change = (
                None if prior_value == 0 else round(absolute_change / abs(prior_value) * 100, 1)
            )

        trend = _trend(direction, current_value, prior_value)
        meets_target = _meets_target(direction, current_value, target)
        severity = _severity(meets_target, trend, percent_change)

        rows.append(
            {
                "kpi_name": name,
                "period": period,
                "baseline_period": base,
                "current_value": current_value,
                "baseline_value": prior_value,
                "target_value": target,
                "unit": unit,
                "direction": direction,
                "absolute_change": absolute_change,
                "percent_change": percent_change,
                "meets_target": meets_target,
                "trend": trend,
                "severity": severity,
            }
        )

    rows.sort(
        key=lambda r: (
            _SEVERITY_RANK[r["severity"]],
            -abs(r["percent_change"] or 0.0),
            r["kpi_name"],
        )
    )

    worst_rank = min((_SEVERITY_RANK[r["severity"]] for r in rows), default=2)
    return {
        "period": period,
        "baseline_period": base,
        "kpi_count": len(rows),
        "risk_level": _RANK_TO_RISK[worst_rank],
        "kpis": rows,
    }


def build_digest_text(summary: dict) -> str:
    """The compact, model-facing view of the month: one line per KPI, numbers only.

    The model is asked to weigh and explain these — never to recompute them — so
    every derived figure (MoM %, target status, trend) is spelled out here.
    """
    lines = [
        f"Month: {summary['period']} (baseline {summary['baseline_period']}). "
        f"{summary['kpi_count']} KPIs tracked."
    ]
    meets_label = {True: "meeting target", False: "below target", None: "no target set"}
    for r in summary["kpis"]:
        pct = "n/a" if r["percent_change"] is None else f"{r['percent_change']:+.1f}%"
        target = "no target" if r["target_value"] is None else f"target {r['target_value']}{r['unit']}"
        lines.append(
            f"- {r['kpi_name']}: {r['current_value']}{r['unit']} "
            f"(was {r['baseline_value']}{r['unit']}, {pct} MoM); {target}; "
            f"{meets_label[r['meets_target']]}; trend {r['trend'] or 'no prior month'} "
            f"[{r['direction']}]"
        )
    return "\n".join(lines)


def render_rule_based_brief(summary: dict, reason: str) -> str:
    """Deterministic fallback briefing, used when client sampling is unavailable or
    refused. Never empty — it always states the overall read, even when nothing is
    wrong — so the tool never silently returns a blank answer.
    """
    header = (
        f"Rule-based summary for {summary['period']} "
        f"(model briefing unavailable: {reason}). "
        f"Overall risk: {summary['risk_level'].upper()}."
    )
    flagged = [r for r in summary["kpis"] if r["severity"] in ("high", "medium")]
    if not flagged:
        return (
            header
            + "\nNo tracked KPI is both below target and worsening this month. "
            "Nothing on these numbers needs the owner's urgent attention."
        )

    bullets = []
    for r in flagged:
        pct = "n/a" if r["percent_change"] is None else f"{r['percent_change']:+.1f}%"
        target = (
            "no target set"
            if r["target_value"] is None
            else f"vs target {r['target_value']}{r['unit']}"
        )
        bullets.append(
            f"- {r['severity'].upper()}: {r['kpi_name']} now {r['current_value']}{r['unit']} "
            f"{target}, {pct} vs {r['baseline_period']}, trend {r['trend'] or 'unknown'}."
        )
    highs = sum(1 for r in flagged if r["severity"] == "high")
    mediums = sum(1 for r in flagged if r["severity"] == "medium")
    footer = f"Watch, worst first: {highs} high / {mediums} medium concern(s)."
    return header + "\n" + "\n".join(bullets) + "\n" + footer
