import { randomUUID } from 'crypto';

/**
 * Holds interface-satisfaction check-ins (STORY-010 / REQ-014; see the
 * "Satisfaction trend mechanism" section of
 * `directives/12-ui-simplicity.md`).
 *
 * Walking-skeleton shortcut, same in-process pattern as every other store
 * in this codebase: a single global list, not a database. Lost on
 * restart.
 *
 * Starts genuinely empty, and nothing in this file ever seeds it — that is
 * the guardrail against a fabricated "satisfaction increased" result. The
 * only way a check-in enters this store is a real submission through
 * `recordCheckin`.
 */

export type SatisfactionRating = 'great' | 'ok' | 'not_great';

export interface SatisfactionCheckin {
  readonly id: string;
  readonly rating: SatisfactionRating;
  readonly submittedAt: string;
}

const checkins: SatisfactionCheckin[] = [];

export function recordCheckin(rating: SatisfactionRating): SatisfactionCheckin {
  const entry: SatisfactionCheckin = {
    id: randomUUID(),
    rating,
    submittedAt: new Date().toISOString(),
  };
  checkins.push(entry);
  return entry;
}

/** Every check-in, oldest first — the order the trend calculation needs. */
export function listCheckins(): SatisfactionCheckin[] {
  return [...checkins].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/** Test seam: reset the in-process check-in store between cases. */
export function clearCheckins(): void {
  checkins.length = 0;
}
