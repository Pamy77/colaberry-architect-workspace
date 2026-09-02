import type { KpiCalculation } from './kpiService';

/**
 * Holds the most recent KPI calculation so the dashboard (GET /api/kpis,
 * STORY-003 / REQ-004) has something to display on access.
 *
 * Walking-skeleton shortcut: a single in-process value, not a database. It is
 * populated by the upload flow (uploadRoute.ts) after KPIs are calculated, and
 * it is lost on restart — after which the dashboard shows "no data" until the
 * next upload. Durable, per-user history is a later persistence story
 * (STORY-014); this is the same in-memory-cache pattern as STORY-011's
 * RecentRuns.
 */

export interface LatestKpiEntry {
  result: KpiCalculation;
  /** Name of the uploaded file the KPIs were calculated from. */
  filename: string;
  /** ISO-8601 timestamp of when the calculation was stored. */
  generatedAt: string;
}

let latest: LatestKpiEntry | null = null;

export function setLatest(entry: LatestKpiEntry): void {
  latest = entry;
}

export function getLatest(): LatestKpiEntry | null {
  return latest;
}

/** Test seam: reset the in-process holder between cases. */
export function clearLatest(): void {
  latest = null;
}
