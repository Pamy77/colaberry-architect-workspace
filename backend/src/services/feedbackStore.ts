import { randomUUID } from 'crypto';

/**
 * Holds user feedback on insights, keyed by `(kpiKey, generatedAt)` — a
 * specific KPI's value from a specific calculation, not the key in the
 * abstract (STORY-009 / REQ-011; see `directives/11-insight-feedback.md`).
 *
 * Walking-skeleton shortcut, same in-process pattern as every other store
 * in this codebase: a single global map, not a database. Lost on restart.
 *
 * Idempotent by construction: resubmitting feedback for the same insight
 * updates the entry in place — the composite key IS the dedup mechanism,
 * same as `financialRecordStore`'s upsert.
 */

export type FeedbackRating = 'accurate' | 'inaccurate';

export interface FeedbackEntry {
  readonly id: string;
  readonly kpiKey: string;
  readonly generatedAt: string;
  rating: FeedbackRating;
  comment: string | null;
  submittedAt: string;
}

function feedbackKey(kpiKey: string, generatedAt: string): string {
  return `${kpiKey}::${generatedAt}`;
}

const feedback = new Map<string, FeedbackEntry>();

/**
 * Stores feedback under its `(kpiKey, generatedAt)` key, replacing
 * whatever was there before. Returns `updated: true` only when an entry
 * already existed for that key — the first submission for an insight is
 * `updated: false`, every resubmission after that is `true`, without the
 * caller needing a separate existence check.
 */
export function recordFeedback(entry: {
  kpiKey: string;
  generatedAt: string;
  rating: FeedbackRating;
  comment?: string | null;
}): { entry: FeedbackEntry; updated: boolean } {
  const key = feedbackKey(entry.kpiKey, entry.generatedAt);
  const existing = feedback.get(key);
  const recorded: FeedbackEntry = {
    id: existing?.id ?? randomUUID(),
    kpiKey: entry.kpiKey,
    generatedAt: entry.generatedAt,
    rating: entry.rating,
    comment: entry.comment ?? null,
    submittedAt: new Date().toISOString(),
  };
  feedback.set(key, recorded);
  return { entry: recorded, updated: existing !== undefined };
}

export function getFeedback(kpiKey: string, generatedAt: string): FeedbackEntry | undefined {
  return feedback.get(feedbackKey(kpiKey, generatedAt));
}

export function hasFeedback(kpiKey: string, generatedAt: string): boolean {
  return feedback.has(feedbackKey(kpiKey, generatedAt));
}

/** Every recorded feedback entry, newest first. */
export function listFeedback(): FeedbackEntry[] {
  return [...feedback.values()].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/** Test seam: reset the in-process feedback store between cases. */
export function clearFeedback(): void {
  feedback.clear();
}
