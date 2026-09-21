import { randomUUID } from 'crypto';
import { getLatest } from './latestKpiStore';
import type { EvidenceLevel } from './kpiService';
import { recordFeedback, hasFeedback, type FeedbackEntry, type FeedbackRating } from './feedbackStore';
import { recordInsightChange } from './insightVersionService';

/**
 * Submits and reports on user feedback for insights (STORY-009 / REQ-011;
 * see `directives/11-insight-feedback.md`).
 *
 * Feedback is only ever recorded against a real insight in the current
 * calculation — `submitFeedback` refuses anything it can't verify, rather
 * than storing feedback that can never be tied back to real data. The
 * "impact" note is a logged observation (does this feedback confirm or
 * contradict the system's own evidence level), not something that changes
 * any calculation — see the directive for why that's out of scope here.
 */

export interface SubmitFeedbackParams {
  kpiKey: string;
  generatedAt: string;
  rating: FeedbackRating;
  comment?: string;
}

export type SubmitFeedbackOutcome = 'recorded' | 'updated' | 'insight_not_found';

export interface SubmitFeedbackResult {
  outcome: SubmitFeedbackOutcome;
  correlationId: string;
  entry?: FeedbackEntry;
}

export interface FeedbackStatus {
  generatedAt: string;
  kpiKeysWithFeedback: string[];
  kpiKeysNeedingFeedback: string[];
}

function logFeedbackEvent(
  outcome: SubmitFeedbackOutcome,
  correlationId: string,
  params: SubmitFeedbackParams,
  impact: string | null,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'insight_not_found' ? 'warn' : 'info',
      service: 'backend',
      event: 'feedback_received',
      correlation_id: correlationId,
      outcome,
      kpiKey: params.kpiKey,
      generatedAt: params.generatedAt,
      rating: params.rating,
      impact,
    }),
  );
}

/** Does this feedback confirm or contradict the system's own confidence? A logged note, not a recalculation. */
function computeImpact(evidenceLevel: EvidenceLevel, rating: FeedbackRating): string {
  if (rating === 'accurate') {
    return `Confirms a ${evidenceLevel}-confidence insight.`;
  }
  if (evidenceLevel === 'high') {
    return 'Contradicts a high-confidence insight — worth investigating.';
  }
  return `Contradicts a ${evidenceLevel}-confidence insight (the system already flagged it as uncertain).`;
}

export function submitFeedback(params: SubmitFeedbackParams): SubmitFeedbackResult {
  const correlationId = randomUUID();

  // Only ever record feedback against a real insight in the current
  // calculation. Documented limitation: latestKpiStore only keeps the two
  // most recent calculations, so feedback on anything older than the
  // current latest reports insight_not_found rather than being validated
  // against history that no longer exists.
  const latest = getLatest();
  const kpi =
    latest && latest.generatedAt === params.generatedAt
      ? latest.result.kpis.find((k) => k.key === params.kpiKey)
      : undefined;

  if (!kpi) {
    logFeedbackEvent('insight_not_found', correlationId, params, null);
    return { outcome: 'insight_not_found', correlationId };
  }

  const { entry, updated } = recordFeedback({
    kpiKey: params.kpiKey,
    generatedAt: params.generatedAt,
    rating: params.rating,
    comment: params.comment,
  });
  const impact = computeImpact(kpi.evidenceLevel, params.rating);
  logFeedbackEvent(updated ? 'updated' : 'recorded', correlationId, params, impact);
  // STORY-014: every successful recording is a version, so it can later be
  // undone. Not called on insight_not_found above — nothing changed there,
  // so there is nothing to version (directives/13-insight-undo.md).
  recordInsightChange(params.kpiKey, params.generatedAt, params.rating, params.comment ?? null);
  return { outcome: updated ? 'updated' : 'recorded', correlationId, entry };
}

/** Which KPI keys in `generatedAt`'s calculation already have feedback, and which still need a prompt. */
export function getFeedbackStatus(generatedAt: string): FeedbackStatus {
  const latest = getLatest();
  if (!latest || latest.generatedAt !== generatedAt) {
    return { generatedAt, kpiKeysWithFeedback: [], kpiKeysNeedingFeedback: [] };
  }

  const kpiKeysWithFeedback: string[] = [];
  const kpiKeysNeedingFeedback: string[] = [];
  for (const kpi of latest.result.kpis) {
    if (hasFeedback(kpi.key, generatedAt)) kpiKeysWithFeedback.push(kpi.key);
    else kpiKeysNeedingFeedback.push(kpi.key);
  }
  return { generatedAt, kpiKeysWithFeedback, kpiKeysNeedingFeedback };
}
