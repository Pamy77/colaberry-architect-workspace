import { useCallback, useEffect, useState } from 'react';
import { DashboardLoadError, fetchKpis } from '../services/kpiApi';
import type { DashboardData } from '../types';
import { KpiCard } from '../components/KpiCard';

/**
 * KPI dashboard (STORY-003 / REQ-004).
 *
 * Four states:
 *  - loading  — the GET /api/kpis call is in flight
 *  - error    — the call failed after retries ("Dashboard fails to load")
 *  - no-data  — the backend has no calculation yet
 *  - loaded   — KPI cards, plus any clarification questions
 */

type ViewState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: DashboardData };

export function Dashboard() {
  const [state, setState] = useState<ViewState>({ phase: 'loading' });

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const data = await fetchKpis();
      setState({ phase: 'ready', data });
    } catch (err) {
      const message =
        err instanceof DashboardLoadError
          ? err.message
          : 'Something went wrong loading the dashboard.';
      setState({ phase: 'error', message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="dashboard">
      <h1>KPI Dashboard</h1>

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

      {state.phase === 'ready' && <DashboardBody data={state.data} />}
    </main>
  );
}

function DashboardBody({ data }: { data: DashboardData }) {
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
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </section>
    </>
  );
}
