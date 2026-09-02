import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { getLatest } from '../services/latestKpiStore';
import {
  DashboardErrorResponse,
  DashboardErrorResponseSchema,
  DashboardResponse,
  DashboardResponseSchema,
} from './dashboardContract';

/**
 * GET /api/kpis — the dashboard's data source (STORY-003 / REQ-004).
 *
 * Returns the most recent KPI calculation, or `{ status: 'no_data' }` when
 * nothing has been calculated yet. Every request emits a `dashboard_access`
 * audit line (STORY-003 acceptance: "the system logs dashboard access and
 * interactions"), carrying a correlation id that is also returned to the
 * caller as `X-Correlation-ID`.
 */

function logDashboardAccess(
  correlationId: string,
  outcome: 'success' | 'failure',
  context: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'failure' ? 'error' : 'info',
      service: 'backend',
      event: 'dashboard_access',
      correlation_id: correlationId,
      outcome,
      context,
    }),
  );
}

export const dashboardRouter = Router();

dashboardRouter.get('/kpis', (_req: Request, res: Response) => {
  const correlationId = randomUUID();
  res.setHeader('X-Correlation-ID', correlationId);

  let entry;
  try {
    entry = getLatest();
  } catch (err) {
    // Failure path: "Dashboard fails to load". Surface a typed 500 rather than
    // letting the frontend hang or render a half-broken page.
    logDashboardAccess(correlationId, 'failure', {
      error_class: err instanceof Error ? err.name || 'Error' : 'UnknownError',
    });
    const payload: DashboardErrorResponse = {
      status: 'error',
      errorClass: 'DashboardUnavailable',
      message: 'The dashboard could not load KPI data. Try again in a moment.',
    };
    sendValidated(res, DashboardErrorResponseSchema, 500, payload);
    return;
  }

  if (!entry) {
    logDashboardAccess(correlationId, 'success', { hasData: false, kpiCount: 0 });
    const payload: DashboardResponse = { status: 'no_data', generatedAt: null };
    sendValidated(res, DashboardResponseSchema, 200, payload);
    return;
  }

  const payload: DashboardResponse = {
    status: entry.result.status,
    generatedAt: entry.generatedAt,
    filename: entry.filename,
    kpis: entry.result.kpis,
    clarificationsNeeded: entry.result.clarificationsNeeded,
    summary: entry.result.summary,
  };
  logDashboardAccess(correlationId, 'success', {
    hasData: true,
    kpiCount: payload.kpis.length,
    status: payload.status,
    clarificationCount: payload.clarificationsNeeded.length,
  });
  sendValidated(res, DashboardResponseSchema, 200, payload);
});
