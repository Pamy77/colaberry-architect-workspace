import csv
import json
from pathlib import Path

SRC = Path(__file__).parent / "Weather_data.csv"

def ordinal(n: int) -> str:
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"

def temp_category(t: float) -> str:
    if t < 20:
        return "Low"
    elif t < 26:
        return "Medium"
    else:
        return "High"

def precip_category(p: float) -> str:
    if p < 2.5:
        return "Light"
    elif p < 7.6:
        return "Moderate"
    else:
        return "Heavy"

rows = []
with open(SRC, newline="") as f:
    reader = csv.DictReader(f)
    for r in reader:
        day = int(r["Day"])
        temp = float(r["Temperature"])
        precip = float(r["Precipitation"])
        rows.append({
            "day": day,
            "day_label": ordinal(day),
            "temperature": round(temp, 2),
            "precipitation": round(precip, 2),
            "temp_category": temp_category(temp),
            "precip_category": precip_category(precip),
        })

# Weekly aggregation: weeks of 7 days (Week 5 is the tail, days 29-30)
weeks = {}
for r in rows:
    week_num = (r["day"] - 1) // 7 + 1
    weeks.setdefault(week_num, []).append(r)

weekly_summary = []
for week_num in sorted(weeks):
    wr = weeks[week_num]
    days_in_week = [r["day"] for r in wr]
    avg_temp = sum(r["temperature"] for r in wr) / len(wr)
    avg_precip = sum(r["precipitation"] for r in wr) / len(wr)
    weekly_summary.append({
        "week": week_num,
        "day_range": f"{min(days_in_week)}-{max(days_in_week)}",
        "num_days": len(wr),
        "avg_temperature": round(avg_temp, 2),
        "avg_precipitation": round(avg_precip, 2),
    })

# Sorting
by_temp_asc = sorted(rows, key=lambda r: r["temperature"])
by_temp_desc = sorted(rows, key=lambda r: r["temperature"], reverse=True)
by_precip_asc = sorted(rows, key=lambda r: r["precipitation"])
by_precip_desc = sorted(rows, key=lambda r: r["precipitation"], reverse=True)
by_day = sorted(rows, key=lambda r: r["day"])

# Category counts
temp_counts = {"Low": 0, "Medium": 0, "High": 0}
precip_counts = {"Light": 0, "Moderate": 0, "Heavy": 0}
for r in rows:
    temp_counts[r["temp_category"]] += 1
    precip_counts[r["precip_category"]] += 1

overall = {
    "avg_temperature": round(sum(r["temperature"] for r in rows) / len(rows), 2),
    "avg_precipitation": round(sum(r["precipitation"] for r in rows) / len(rows), 2),
    "min_temperature": min(rows, key=lambda r: r["temperature"]),
    "max_temperature": max(rows, key=lambda r: r["temperature"]),
    "min_precipitation": min(rows, key=lambda r: r["precipitation"]),
    "max_precipitation": max(rows, key=lambda r: r["precipitation"]),
    "total_precipitation": round(sum(r["precipitation"] for r in rows), 2),
}

output = {
    "rows": rows,
    "weekly_summary": weekly_summary,
    "sorted": {
        "by_temp_asc": [r["day"] for r in by_temp_asc],
        "by_temp_desc": [r["day"] for r in by_temp_desc],
        "by_precip_asc": [r["day"] for r in by_precip_asc],
        "by_precip_desc": [r["day"] for r in by_precip_desc],
        "by_day": [r["day"] for r in by_day],
    },
    "temp_counts": temp_counts,
    "precip_counts": precip_counts,
    "overall": overall,
}

out_path = Path(__file__).parent / "weather_analysis.json"
out_path.write_text(json.dumps(output, indent=2))
print(f"Wrote {out_path}")
print(json.dumps(overall, indent=2))
