import { randomUUID } from 'crypto';
import {
  clearCheckins as _clearCheckins,
  listCheckins,
  recordCheckin as storeCheckin,
  type SatisfactionCheckin,
  type SatisfactionRating,
} from './satisfactionStore';

/**
 * Records satisfaction check-ins and computes whether satisfaction is
 * trending up over time (STORY-010 / REQ-014; see the "Satisfaction trend
 * mechanism" section of `directives/12-ui-simplicity.md`).
 *
 * What is proven correct here is the *computation* — given a real
 * sequence of check-ins, does the trend get reported accurately — not a
 * live claim that real satisfaction has already increased. That claim can
 * only become true from real usage; this only guarantees it will be
 * answered honestly when it does.
 */

// A 3-point scale kept as 3 points, not stretched into a false-precision
// 5-point average.
const RATING_SCORE: Record<SatisfactionRating, number> = {
  not_great: 1,
  ok: 2,
  great: 3,
};

export type SatisfactionTrendStatus = 'increased' | 'decreased' | 'flat' | 'insufficient_data';

export interface SatisfactionTrend {
  status: SatisfactionTrendStatus;
  totalCheckins: number;
  earlierAverage: number | null;
  laterAverage: number | null;
  generatedAt: string;
  correlationId: string;
}

function logSatisfactionEvent(event: string, context: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'backend',
      event,
      ...context,
    }),
  );
}

export function recordSatisfactionCheckin(rating: SatisfactionRating): SatisfactionCheckin {
  const entry = storeCheckin(rating);
  logSatisfactionEvent('satisfaction_checkin', {
    correlation_id: randomUUID(),
    rating: entry.rating,
    submittedAt: entry.submittedAt,
  });
  return entry;
}

function average(checkins: SatisfactionCheckin[]): number {
  const sum = checkins.reduce((total, c) => total + RATING_SCORE[c.rating], 0);
  return sum / checkins.length;
}

/**
 * Chronological split (first half vs. second half by count), not a
 * calendar-window split — a "this week vs last week" comparison would
 * report insufficient_data indefinitely for a lightly-used walking
 * skeleton even with several real check-ins on the same day. Documented
 * choice, not a hidden one (see the directive).
 */
export function computeSatisfactionTrend(): SatisfactionTrend {
  const correlationId = randomUUID();
  const generatedAt = new Date().toISOString();
  const checkins = listCheckins();

  if (checkins.length < 2) {
    const trend: SatisfactionTrend = {
      status: 'insufficient_data',
      totalCheckins: checkins.length,
      earlierAverage: null,
      laterAverage: null,
      generatedAt,
      correlationId,
    };
    logSatisfactionEvent('satisfaction_trend_computed', {
      correlation_id: correlationId,
      status: trend.status,
      totalCheckins: trend.totalCheckins,
    });
    return trend;
  }

  const midpoint = Math.floor(checkins.length / 2);
  const earlier = checkins.slice(0, midpoint);
  const later = checkins.slice(midpoint);
  const earlierAverage = average(earlier);
  const laterAverage = average(later);

  const status: SatisfactionTrendStatus =
    laterAverage > earlierAverage ? 'increased' : laterAverage < earlierAverage ? 'decreased' : 'flat';

  const trend: SatisfactionTrend = {
    status,
    totalCheckins: checkins.length,
    earlierAverage,
    laterAverage,
    generatedAt,
    correlationId,
  };
  logSatisfactionEvent('satisfaction_trend_computed', {
    correlation_id: correlationId,
    status: trend.status,
    totalCheckins: trend.totalCheckins,
    earlierAverage: trend.earlierAverage,
    laterAverage: trend.laterAverage,
  });
  return trend;
}
