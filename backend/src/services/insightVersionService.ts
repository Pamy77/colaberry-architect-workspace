import { randomUUID } from 'crypto';
import { appendVersion, listVersions } from './insightVersionStore';
import { recordFeedback, type FeedbackRating } from './feedbackStore';

/**
 * Records insight-feedback changes and undoes the most recent one
 * (STORY-014 / REQ-010; see `directives/13-insight-undo.md`).
 *
 * History is append-only (the `git revert` model, not `git reset`): undo
 * never deletes the change it reverses, it appends a new version
 * restoring the prior state. This is also why undoing twice in a row
 * toggles back and forth predictably rather than running out of history
 * after one use.
 */

export type UndoOutcome = 'restored' | 'irreversible';

export interface UndoResult {
  outcome: UndoOutcome;
  restoredRating?: FeedbackRating;
  restoredComment?: string | null;
  correlationId: string;
}

function logInsightVersionEvent(event: string, context: Record<string, unknown>): void {
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

/**
 * Called from `feedbackService.submitFeedback` on every successful
 * recording — additive, does not change that function's own return
 * value. Not called when a submission is rejected (`insight_not_found`):
 * nothing changed, so there is nothing to version.
 */
export function recordInsightChange(
  kpiKey: string,
  generatedAt: string,
  rating: FeedbackRating,
  comment: string | null,
): void {
  const version = appendVersion({ kpiKey, generatedAt, rating, comment, reason: 'change' });
  logInsightVersionEvent('insight_change_recorded', {
    correlation_id: randomUUID(),
    kpiKey,
    generatedAt,
    rating,
    versionId: version.id,
  });
}

export function undoInsightChange(kpiKey: string, generatedAt: string): UndoResult {
  const correlationId = randomUUID();
  const versions = listVersions(kpiKey, generatedAt);

  // Fewer than 2 versions: either nothing was ever changed, or this is the
  // first-ever version — either way there is nothing before the current
  // state to restore to.
  if (versions.length < 2) {
    logInsightVersionEvent('insight_undo', {
      correlation_id: correlationId,
      kpiKey,
      generatedAt,
      outcome: 'irreversible',
      versionCount: versions.length,
    });
    return { outcome: 'irreversible', correlationId };
  }

  // The state before the most recent change/undo — appended again as a
  // new version (never deleting the one it reverses), and applied to the
  // live feedback state in this same synchronous call so history and
  // live state can never diverge (no gap for a "Version control error").
  const restoreTo = versions[versions.length - 2];
  appendVersion({
    kpiKey,
    generatedAt,
    rating: restoreTo.rating,
    comment: restoreTo.comment,
    reason: 'undo',
  });
  recordFeedback({ kpiKey, generatedAt, rating: restoreTo.rating, comment: restoreTo.comment });

  logInsightVersionEvent('insight_undo', {
    correlation_id: correlationId,
    kpiKey,
    generatedAt,
    outcome: 'restored',
    restoredRating: restoreTo.rating,
  });

  return {
    outcome: 'restored',
    restoredRating: restoreTo.rating,
    restoredComment: restoreTo.comment,
    correlationId,
  };
}
