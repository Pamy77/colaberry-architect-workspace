import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { getLatest, getPrevious } from '../services/latestKpiStore';
import { ALERT_THRESHOLD_PCT, detectKpiAlerts } from '../services/alertDetectionService';
import { sendKpiAlert } from '../services/notificationService';
import { AlertRunResponse, AlertRunResponseSchema } from './alertsContract';

/**
 * POST /api/alerts/run — compare the latest KPI calculation to the previous one
 * and, if something moved significantly, send an alert (STORY-004 / REQ-005).
 *
 * Deterministic and idempotent: the same pair of calculations produces the same
 * alert, and the notification service will not send it twice. Meant to be
 * called after an upload, by a scheduler, or by hand.
 */

export const alertsRouter = Router();

alertsRouter.post('/alerts/run', async (_req: Request, res: Response) => {
  const correlationId = randomUUID();
  res.setHeader('X-Correlation-ID', correlationId);

  const current = getLatest();
  if (!current) {
    return send(res, { status: 'no_data', alertId: null, alerts: [], channels: [] });
  }

  const previous = getPrevious();
  if (!previous) {
    return send(res, { status: 'no_baseline', alertId: null, alerts: [], channels: [] });
  }

  const alerts = detectKpiAlerts(previous.result.kpis, current.result.kpis);
  if (alerts.length === 0) {
    return send(res, { status: 'no_changes', alertId: null, alerts: [], channels: [] });
  }

  const result = await sendKpiAlert(alerts, { generatedAt: current.generatedAt });

  if (result.reason === 'duplicate') {
    return send(res, {
      status: 'already_sent',
      alertId: result.alertId ?? null,
      alerts,
      channels: [],
    });
  }

  if (!result.sent) {
    return send(
      res,
      { status: 'send_failed', alertId: result.alertId ?? null, alerts, channels: result.channels },
      502,
    );
  }

  return send(res, {
    status: 'sent',
    alertId: result.alertId ?? null,
    alerts,
    channels: result.channels,
  });
});

function send(res: Response, body: Omit<AlertRunResponse, 'thresholdPct'>, status = 200): void {
  const payload: AlertRunResponse = { ...body, thresholdPct: ALERT_THRESHOLD_PCT };
  sendValidated(res, AlertRunResponseSchema, status, payload);
}
