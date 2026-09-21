import type { Kpi, KpiUnit } from '../types';
import type { FeedbackRating } from '../services/feedbackApi';

const FORMATTERS: Record<KpiUnit, (value: number) => string> = {
  // Currency assumes USD for now (small-business default); a later story can
  // make this configurable.
  currency: (value) => value.toLocaleString(undefined, { style: 'currency', currency: 'USD' }),
  ratio: (value) => `${(value * 100).toFixed(1)}%`,
  number: (value) => value.toLocaleString(),
};

const EVIDENCE_LABEL: Record<Kpi['evidenceLevel'], string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

export interface KpiCardProps {
  kpi: Kpi;
  /**
   * Whether this insight (this KPI at this calculation) still needs
   * feedback (STORY-009 / REQ-011). Defaults to false — no prompt — so
   * every existing call site that doesn't pass this is unaffected.
   */
  needsFeedback?: boolean;
  /** The rating already given for this insight, if any. */
  feedbackRating?: FeedbackRating | null;
  /**
   * Called when the user picks a rating. This component is purely
   * presentational for feedback — it has no submission/loading/error
   * state of its own; the page (`Dashboard.tsx`) owns the actual API call
   * and re-renders with updated `needsFeedback`/`feedbackRating` once it
   * resolves, same as it already owns the page's own load state.
   */
  onSubmitFeedback?: (rating: FeedbackRating) => void;
  /**
   * Called when the user clicks Undo (STORY-014 / REQ-010). Offered only
   * when `feedbackRating` is set — there is nothing to undo otherwise.
   * Same "page owns the API call" split as `onSubmitFeedback`.
   */
  onUndo?: () => void;
}

export function KpiCard({
  kpi,
  needsFeedback = false,
  feedbackRating = null,
  onSubmitFeedback,
  onUndo,
}: KpiCardProps) {
  return (
    <article className="kpi-card" aria-label={kpi.label}>
      <h3 className="kpi-card__label">{kpi.label}</h3>
      <p className="kpi-card__value">{FORMATTERS[kpi.unit](kpi.value)}</p>
      <span className={`kpi-card__evidence kpi-card__evidence--${kpi.evidenceLevel}`}>
        {EVIDENCE_LABEL[kpi.evidenceLevel]}
      </span>
      <p className="kpi-card__note">{kpi.evidenceNote}</p>

      {needsFeedback && (
        <div className="kpi-card__feedback-prompt">
          <p>Was this insight accurate?</p>
          <button type="button" onClick={() => onSubmitFeedback?.('accurate')}>
            Accurate
          </button>
          <button type="button" onClick={() => onSubmitFeedback?.('inaccurate')}>
            Inaccurate
          </button>
        </div>
      )}

      {!needsFeedback && feedbackRating && (
        <p className="kpi-card__feedback-given">
          You rated this <strong>{feedbackRating}</strong>.{' '}
          <button type="button" className="kpi-card__undo" onClick={() => onUndo?.()}>
            Undo
          </button>
        </p>
      )}
    </article>
  );
}
