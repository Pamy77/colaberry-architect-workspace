import { useCallback, useEffect, useState } from 'react';
import { DashboardLoadError, fetchKpis } from '../services/kpiApi';
import {
  FeedbackApiError,
  fetchFeedbackStatus,
  submitInsightFeedback,
  type FeedbackRating,
} from '../services/feedbackApi';
import { InsightUndoApiError, undoInsightFeedback } from '../services/insightUndoApi';
import type { DashboardData, Kpi, MonthlyTotal } from '../types';
import { KpiCard } from '../components/KpiCard';
import { UploadForm } from '../components/UploadForm';
import { SatisfactionCheckin } from '../components/SatisfactionCheckin';
import { TrendBarChart } from '../components/TrendBarChart';
import { formatDateRangeLabel } from '../utils/dateFormat';

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

  const handleUndo = useCallback(async (kpiKey: string, generatedAt: string) => {
    setFeedbackError(null);
    try {
      const result = await undoInsightFeedback(kpiKey, generatedAt);
      if (result.outcome === 'irreversible') {
        setFeedbackError('Nothing earlier to undo to for this insight.');
        return;
      }
      if (result.restoredRating) {
        setFeedbackByKpiKey((prev) => ({ ...prev, [kpiKey]: result.restoredRating as FeedbackRating }));
      }
    } catch (err) {
      setFeedbackError(err instanceof InsightUndoApiError ? err.message : 'Could not undo.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dateRangeLabel =
    state.phase === 'ready' && state.data.status !== 'no_data'
      ? formatDateRangeLabel(state.data.summary.dateRange)
      : null;

  return (
    <main className="dashboard">
      <h1>KPI Dashboard{dateRangeLabel && <span className="dashboard__daterange"> – {dateRangeLabel}</span>}</h1>

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
          onUndo={(kpiKey) => {
            if (state.data.status === 'no_data') return;
            void handleUndo(kpiKey, state.data.generatedAt);
          }}
        />
      )}

      {/* Quiet, not competing with the primary upload/KPI content — see
          the "Satisfaction trend mechanism" section of
          directives/12-ui-simplicity.md. */}
      <SatisfactionCheckin />
    </main>
  );
}

function DashboardBody({
  data,
  kpiKeysNeedingFeedback,
  feedbackByKpiKey,
  onSubmitFeedback,
  onUndo,
}: {
  data: DashboardData;
  kpiKeysNeedingFeedback: string[];
  feedbackByKpiKey: Record<string, FeedbackRating>;
  onSubmitFeedback: (kpiKey: string, rating: FeedbackRating) => void;
  onUndo: (kpiKey: string) => void;
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

      <KpiGrid
        kpis={data.kpis}
        monthlySeries={data.summary.monthlySeries}
        kpiKeysNeedingFeedback={kpiKeysNeedingFeedback}
        feedbackByKpiKey={feedbackByKpiKey}
        onSubmitFeedback={onSubmitFeedback}
        onUndo={onUndo}
      />
    </>
  );
}

// Row 1: revenue total, revenue average, revenue trend chart.
// Row 2: expense total, expense average, expense trend chart.
// Row 3: gross profit, gross margin, sales trend.
// Revenue/expense KPIs are matched by the backend's `category` tag rather
// than by label or column name (that name is whatever the uploaded file
// called it, e.g. "sales" instead of "revenue"). Anything that doesn't fit
// one of those nine slots (a dataset with extra numeric columns beyond
// revenue/expenses) still renders, just below in its own grid, so it's
// never silently dropped.
function KpiGrid({
  kpis,
  monthlySeries,
  kpiKeysNeedingFeedback,
  feedbackByKpiKey,
  onSubmitFeedback,
  onUndo,
}: {
  kpis: Kpi[];
  monthlySeries: MonthlyTotal[];
  kpiKeysNeedingFeedback: string[];
  feedbackByKpiKey: Record<string, FeedbackRating>;
  onSubmitFeedback: (kpiKey: string, rating: FeedbackRating) => void;
  onUndo: (kpiKey: string) => void;
}) {
  const revenueTotal = kpis.find((k) => k.category === 'revenue' && k.key.endsWith('.total'));
  const revenueAverage = kpis.find((k) => k.category === 'revenue' && k.key.endsWith('.average'));
  const expenseTotal = kpis.find((k) => k.category === 'expenses' && k.key.endsWith('.total'));
  const expenseAverage = kpis.find((k) => k.category === 'expenses' && k.key.endsWith('.average'));
  const grossProfit = kpis.find((k) => k.key === 'business.profit.gross');
  const grossMargin = kpis.find((k) => k.key === 'business.margin.gross');
  const salesTrend = kpis.find((k) => k.key === 'business.revenue.trend.momAvg');

  const coreKeys = new Set(
    [revenueTotal, revenueAverage, expenseTotal, expenseAverage, grossProfit, grossMargin, salesTrend]
      .filter((k): k is Kpi => k !== undefined)
      .map((k) => k.key),
  );
  const otherKpis = kpis.filter((k) => !coreKeys.has(k.key));

  function card(kpi: Kpi | undefined) {
    if (!kpi) return null;
    return (
      <KpiCard
        key={kpi.key}
        kpi={kpi}
        needsFeedback={kpiKeysNeedingFeedback.includes(kpi.key)}
        feedbackRating={feedbackByKpiKey[kpi.key] ?? null}
        onSubmitFeedback={(rating) => onSubmitFeedback(kpi.key, rating)}
        onUndo={() => onUndo(kpi.key)}
      />
    );
  }

  return (
    <>
      <section className="kpi-grid kpi-grid--core" aria-label="KPIs">
        {card(revenueTotal)}
        {card(revenueAverage)}
        <TrendBarChart title="Revenue trend" data={monthlySeries} metric="revenue" color="#6fae8c" />

        {card(expenseTotal)}
        {card(expenseAverage)}
        <TrendBarChart title="Expense trend" data={monthlySeries} metric="expenses" color="#a4575b" />

        {card(grossProfit)}
        {card(grossMargin)}
        {card(salesTrend)}
      </section>

      {otherKpis.length > 0 && (
        <section className="kpi-grid" aria-label="Other KPIs">
          {otherKpis.map((kpi) => card(kpi))}
        </section>
      )}
    </>
  );
}
