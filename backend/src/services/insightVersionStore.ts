import { randomUUID } from 'crypto';
import type { FeedbackRating } from './feedbackStore';

/**
 * Append-only version history of insight feedback changes (STORY-014 /
 * REQ-010; see `directives/13-insight-undo.md`).
 *
 * Walking-skeleton shortcut, same in-process pattern as every other store
 * in this codebase: a single global map, not a database. Lost on restart.
 *
 * Never destructively edited — same philosophy as `decisionLog.ts` /
 * `feedbackStore.ts` / `satisfactionStore.ts`. An undo appends a new
 * version restoring a prior state; nothing already recorded is ever
 * removed or overwritten.
 */

export interface InsightVersionEntry {
  readonly id: string;
  readonly kpiKey: string;
  readonly generatedAt: string;
  readonly rating: FeedbackRating;
  readonly comment: string | null;
  readonly recordedAt: string;
  readonly reason: 'change' | 'undo';
}

function insightKey(kpiKey: string, generatedAt: string): string {
  return `${kpiKey}::${generatedAt}`;
}

const versionsByInsight = new Map<string, InsightVersionEntry[]>();

export function appendVersion(args: {
  kpiKey: string;
  generatedAt: string;
  rating: FeedbackRating;
  comment: string | null;
  reason: 'change' | 'undo';
}): InsightVersionEntry {
  const entry: InsightVersionEntry = {
    id: randomUUID(),
    kpiKey: args.kpiKey,
    generatedAt: args.generatedAt,
    rating: args.rating,
    comment: args.comment,
    recordedAt: new Date().toISOString(),
    reason: args.reason,
  };
  const key = insightKey(args.kpiKey, args.generatedAt);
  const existing = versionsByInsight.get(key);
  if (existing) {
    existing.push(entry);
  } else {
    versionsByInsight.set(key, [entry]);
  }
  return entry;
}

/** Every version for one insight, oldest first. Empty if it has never changed. */
export function listVersions(kpiKey: string, generatedAt: string): InsightVersionEntry[] {
  return [...(versionsByInsight.get(insightKey(kpiKey, generatedAt)) ?? [])];
}

/** Test seam: reset all version history between cases. */
export function clearVersions(): void {
  versionsByInsight.clear();
}
