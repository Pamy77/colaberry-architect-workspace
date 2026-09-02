import type { KpiCalculation } from './kpiService';

/**
 * Holds the most recent KPI calculation so the dashboard (GET /api/kpis,
 * STORY-003 / REQ-004) has something to display, and the one before it so
 * alerting (STORY-004 / REQ-005) can detect significant changes.
 *
 * Walking-skeleton shortcut: two in-process values, not a database. Populated
 * by the upload flow (uploadRoute.ts) after KPIs are calculated, and lost on
 * restart. Durable, per-user history is a later persistence story (STORY-014);
 * this is the same in-memory-cache pattern as STORY-011's RecentRuns.
 *
 * `setLatest` always shifts the current entry into `previous`. Re-uploading the
 * same file therefore collapses previous == latest (so no change is detected
 * for that pair), which is the intended reading of "nothing significant
 * happened"; the rarer case of re-uploading an older file before alerts have
 * run can drop an un-checked comparison. Acceptable until STORY-014.
 */

export interface LatestKpiEntry {
  result: KpiCalculation;
  /** Name of the uploaded file the KPIs were calculated from. */
  filename: string;
  /** ISO-8601 timestamp of when the calculation was stored. */
  generatedAt: string;
}

let latest: LatestKpiEntry | null = null;
let previous: LatestKpiEntry | null = null;

export function setLatest(entry: LatestKpiEntry): void {
  previous = latest;
  latest = entry;
}

export function getLatest(): LatestKpiEntry | null {
  return latest;
}

/** The calculation before the current one — the baseline for change detection. */
export function getPrevious(): LatestKpiEntry | null {
  return previous;
}

/** Test seam: reset the in-process holders between cases. */
export function clearLatest(): void {
  latest = null;
  previous = null;
}
