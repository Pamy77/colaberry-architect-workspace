import { useCallback, useEffect, useState } from 'react';
import { DashboardLoadError, fetchKpis } from '../services/kpiApi';
import {
  FeedbackApiError,
  fetchFeedbackStatus,
  submitInsightFeedback,
  type FeedbackRating,
} from '../services/feedbackApi';
import type { DashboardData } from '../types';
import { KpiCard } from '../components/KpiCard';
import { UploadForm } from '../components/UploadForm';

/**
 * KPI dashboard (STORY-003 / REQ-004, extended STORY-007 / STORY-009 /
 * STORY-010).
 *
 * Four load states:
 *  - loading  — the GET /api/kpis call is in flight
 *  - error    — the call failed after retries ("Dashboard fails to load")
 *  - no-data  — the backend has no calculation yet
 *  - loaded   — KPI cards, plus any clarification questions
 *
 * Feedback status (which KPIs still need a prompt, STORY-009 / REQ-011) is
 * fetched alongside the main load but tracked separately and never blocks
 * it — a failed feedback-status fetch just means no prompts show yet,
 * never a broken dashboard ("User interface issues": a secondary failure
 * must not break the primary view).
 */

type ViewState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: DashboardData };

export function Dashboard() {
  const [state, setState] = useState<ViewState>({ phase: 'loading' });
  const [kpiKeysNeedingFeedback, setKpiKeysNeedingFeedback] = useState<string[]>([]);
  // Only tracks feedback submitted THIS session — the status fetch already
  // tells a card not to prompt again for feedback from a prior session, but
  // getFeedbackStatus only returns keys, not the past rating, so a card
  // with older feedback shows neither prompt nor confirmation rather than
  // guessing at a rating the frontend was never told. Documented scoping
  // choice, not an oversight.
  const [feedbackByKpiKey, setFeedbackByKpiKey] = useState<Record<string, FeedbackRating>>({});
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const loadFeedbackStatus = useCallback(async (generatedAt: string) => {
    try {
      const status = await fetchFeedbackStatus(generatedAt);
      setKpiKeysNeedingFeedback(status.kpiKeysNeedingFeedback);
    } catch {
      setKpiKeysNeedingFeedback([]);
    }
  }, []);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    setFeedbackByKpiKey({});
    setFeedbackError(null);
    try {
      const data = await fetchKpis();
      setState({ phase: 'ready', data });
      if (data.status !== 'no_data') {
        void loadFeedbackStatus(data.generatedAt);
      }
    } catch (err) {
      const message =
        err instanceof DashboardLoadError
          ? err.message
          : 'Something went wrong loading the dashboard.';
      setState({ phase: 'error', message });
    }
  }, [loadFeedbackStatus]);

  const handleSubmitFeedback = useCallback(
    async (kpiKey: string, generatedAt: string, rating: FeedbackRating) => {
      setFeedbackError(null);
      try {
        const result = await submitInsightFeedback({ kpiKey, generatedAt, rating });
        if (result.outcome === 'insight_not_found') {
          setFeedbackError('This insight could not be found — try refreshing the dashboard.');
          return;
        }
        setFeedbackByKpiKey((prev) => ({ ...prev, [kpiKey]: rating }));
        setKpiKeysNeedingFeedback((prev) => prev.filter((key) => key !== kpiKey));
      } catch (err) {
        setFeedbackError(
          err instanceof FeedbackApiError ? err.message : 'Could not submit your feedback.',
        );
      }
    },
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="dashboard">
      <h1>KPI Dashboard</h1>

      {/* Always visible, regardless of load state — the upload path
          (STORY-010 / REQ-018) never depends on the dashboard already
          having data, and reloads it automatically on success. */}
      <UploadForm onUploaded={() => void load()} />

      {state.phase === 'loading' && (
        <p className="dashboard__status">Loading your KPIs…</p>
      )}

      {state.phase === 'error' && (
        <div className="dashboard__error" role="alert">
          <p>{state.message}</p>
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {feedbackError && (
        <div className="dashboard__feedback-error" role="alert">
          <p>{feedbackError}</p>
        </div>
      )}

      {state.phase === 'ready' && (
        <DashboardBody
          data={state.data}
          kpiKeysNeedingFeedback={kpiKeysNeedingFeedback}
          feedbackByKpiKey={feedbackByKpiKey}
          onSubmitFeedback={(kpiKey, rating) => {
            if (state.data.status === 'no_data') return;
            void handleSubmitFeedback(kpiKey, state.data.generatedAt, rating);
          }}
        />
      )}
    </main>
  );
}

function DashboardBody({
  data,
  kpiKeysNeedingFeedback,
  feedbackByKpiKey,
  onSubmitFeedback,
}: {
  data: DashboardData;
  kpiKeysNeedingFeedback: string[];
  feedbackByKpiKey: Record<string, FeedbackRating>;
  onSubmitFeedback: (kpiKey: string, rating: FeedbackRating) => void;
}) {
  if (data.status === 'no_data') {
    return (
      <p className="dashboard__empty">
        No KPIs yet. Upload an Excel or CSV file to see your business metrics here.
      </p>
    );
  }

  return (
    <>
      <p className="dashboard__meta">
        From <strong>{data.filename}</strong> ·{' '}
        {new Date(data.generatedAt).toLocaleString()} · {data.summary.cleanedRowCount} clean row(s),{' '}
        {data.summary.flaggedRowCount} flagged
      </p>

      {data.clarificationsNeeded.length > 0 && (
        <section className="dashboard__clarifications" aria-label="Questions about your data">
          <h2>Before these numbers are final</h2>
          <ul>
            {data.clarificationsNeeded.map((c, i) => (
              <li key={`${c.code}-${i}`}>{c.question}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="kpi-grid" aria-label="KPIs">
        {data.kpis.map((kpi) => (
          <KpiCard
            key={kpi.key}
            kpi={kpi}
            needsFeedback={kpiKeysNeedingFeedback.includes(kpi.key)}
            feedbackRating={feedbackByKpiKey[kpi.key] ?? null}
            onSubmitFeedback={(rating) => onSubmitFeedback(kpi.key, rating)}
          />
        ))}
      </section>
    </>
  );
}
