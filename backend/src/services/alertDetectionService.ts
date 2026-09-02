import type { Kpi } from './kpiService';

/**
 * Significant-change detection for alerting (STORY-004 / REQ-005, and the
 * project guardrail "verify significant drops or increases in KPIs before
 * sending alerts").
 *
 * Pure and total — no I/O. Given the previous and current KPI sets, it returns
 * the changes big enough to alert on. The model mirrors the `verify_kpi_movement`
 * MCP tool (that tool is Claude's; this is the app's deterministic equivalent):
 *
 *   absoluteChange = current - previous
 *   percentChange  = absoluteChange / |previous| * 100   (null when previous is 0)
 *   significant    = |percentChange| >= thresholdPct     (any move from 0 counts)
 *
 * STORY-012 ("Verify KPI Changes Before Alerting") will layer a stronger check
 * on top of this; the notification service calls this first.
 */

export interface KpiAlert {
  key: string;
  label: string;
  unit: Kpi['unit'];
  previousValue: number;
  currentValue: number;
  absoluteChange: number;
  /** null when the previous value was 0 (percent change is undefined). */
  percentChange: number | null;
  direction: 'increase' | 'decrease';
  /** The weaker evidence level of the two readings — surfaced for STORY-012 / alert copy. */
  evidenceLevel: Kpi['evidenceLevel'];
  thresholdPct: number;
  reason: string;
}

export interface DetectOptions {
  /** Percent swing (absolute) needed to alert. Defaults to ALERT_THRESHOLD_PCT. */
  thresholdPct?: number;
}

// Env-configurable, same pattern as kpiService's KPI_*_EVIDENCE_MIN. Default 15
// matches the verify_kpi_movement MCP tool.
export const ALERT_THRESHOLD_PCT = readThresholdPct('ALERT_THRESHOLD_PCT', 15);

function readThresholdPct(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const EVIDENCE_ORDER = ['low', 'medium', 'high'] as const;

function weakerEvidence(a: Kpi['evidenceLevel'], b: Kpi['evidenceLevel']): Kpi['evidenceLevel'] {
  return EVIDENCE_ORDER.indexOf(a) <= EVIDENCE_ORDER.indexOf(b) ? a : b;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Locale-free number formatting, so alert copy is identical across environments. */
function fmt(n: number): string {
  return String(round(n, 4));
}

export function detectKpiAlerts(
  previous: Kpi[],
  current: Kpi[],
  options: DetectOptions = {},
): KpiAlert[] {
  const thresholdPct = options.thresholdPct ?? ALERT_THRESHOLD_PCT;
  const previousByKey = new Map(previous.map((k) => [k.key, k]));
  const alerts: KpiAlert[] = [];

  for (const cur of current) {
    const prev = previousByKey.get(cur.key);
    // No baseline -> not a "change". A brand-new KPI is not alerted on here
    // (documented limitation); it has no prior value to move from.
    if (!prev) continue;

    const absoluteChange = round(cur.value - prev.value, 4);
    if (absoluteChange === 0) continue;

    let percentChange: number | null;
    let significant: boolean;
    if (prev.value === 0) {
      percentChange = null;
      significant = true; // any move away from zero is treated as significant
    } else {
      percentChange = round((absoluteChange / Math.abs(prev.value)) * 100, 1);
      significant = Math.abs(percentChange) >= thresholdPct;
    }
    if (!significant) continue;

    const direction: KpiAlert['direction'] = absoluteChange > 0 ? 'increase' : 'decrease';
    const verb = direction === 'increase' ? 'rose' : 'fell';
    const magnitude = percentChange === null ? 'from zero' : `${Math.abs(percentChange)}%`;

    alerts.push({
      key: cur.key,
      label: cur.label,
      unit: cur.unit,
      previousValue: prev.value,
      currentValue: cur.value,
      absoluteChange,
      percentChange,
      direction,
      evidenceLevel: weakerEvidence(prev.evidenceLevel, cur.evidenceLevel),
      thresholdPct,
      reason: `${cur.label} ${verb} ${magnitude} (${fmt(prev.value)} → ${fmt(cur.value)})`,
    });
  }

  return alerts;
}
