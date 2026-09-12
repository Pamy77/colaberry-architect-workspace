import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { getLatest, getPrevious } from '../services/latestKpiStore';
import { ALERT_THRESHOLD_PCT, detectKpiAlerts } from '../services/alertDetectionService';
import { buildAlertContent, deriveAlertKey, logAlertEvent, sendKpiAlert } from '../services/notificationService';
import {
  getPendingById,
  listPending,
  markApproved,
  markRejected,
  upsertPending,
} from '../services/pendingAlertStore';
import {
  AlertActionErrorResponse,
  AlertActionErrorResponseSchema,
  AlertRunResponse,
  AlertRunResponseSchema,
  ApproveAlertResponse,
  ApproveAlertResponseSchema,
  PendingAlertListResponseSchema,
  RejectAlertResponse,
  RejectAlertResponseSchema,
} from './alertsContract';

/**
 * Alert detection + the human-approval hold in front of delivery (STORY-004 /
 * REQ-005, hardened by STORY-012 / REQ-013).
 *
 *   POST /api/alerts/run           — detect + (gated) draft-or-send
 *   POST /api/alerts/:id/approve   — human confirms a drafted alert -> send
 *   POST /api/alerts/:id/reject    — human declines a drafted alert -> never send
 *   GET  /api/alerts/pending       — what's currently waiting on a human
 *
 * Deterministic and idempotent throughout: the same pair of calculations
 * produces the same alert id; the same id is never drafted twice
 * (`pendingAlertStore.upsertPending`) and never sent twice (this route's own
 * "already approved -> reuse cached result" short-circuit, backed by
 * `notificationService`'s `sentAlertKeys` dedup as the last line of defense).
 *
 * ALERT_REQUIRE_APPROVAL (default true / "on"): while on, a significant
 * change is drafted and held for a human via approve/reject and
 * `sendKpiAlert` is never called from `run`. Set to the literal string
 * `'false'` to skip the hold and restore the pre-STORY-012 immediate-send
 * behavior — the single switch for "once you trust it, make it fully
 * autonomous" (see directives/05-alerts.md).
 */

export const alertsRouter = Router();

// Same load-time env-parsing shape as alertDetectionService's
// ALERT_THRESHOLD_PCT / readThresholdPct: read once, raw string in, typed
// value out, explicit fallback. Boolean rule: default ON; only the literal
// string 'false' turns it off, so a mistyped or empty value fails safe (hold
// stays up) rather than silently disabling the gate.
export const ALERT_REQUIRE_APPROVAL = readRequireApproval();

function readRequireApproval(): boolean {
  const raw = process.env.ALERT_REQUIRE_APPROVAL;
  if (!raw) return true;
  return raw !== 'false';
}

alertsRouter.post('/alerts/run', async (_req: Request, res: Response) => {
  const correlationId = randomUUID();
  res.setHeader('X-Correlation-ID', correlationId);

  const current = getLatest();
  if (!current) {
    return send(res, { status: 'no_data', alertId: null, alerts: [], channels: [], content: null });
  }

  const previous = getPrevious();
  if (!previous) {
    return send(res, { status: 'no_baseline', alertId: null, alerts: [], channels: [], content: null });
  }

  const alerts = detectKpiAlerts(previous.result.kpis, current.result.kpis);
  if (alerts.length === 0) {
    return send(res, { status: 'no_changes', alertId: null, alerts: [], channels: [], content: null });
  }

  if (ALERT_REQUIRE_APPROVAL) {
    const alertId = deriveAlertKey(alerts, current.generatedAt);
    const content = buildAlertContent(alerts);
    const entry = upsertPending(alertId, alerts, content, current.generatedAt);

    logAlertEvent('info', {
      event: 'pending_approval',
      outcome: 'success',
      correlation_id: correlationId,
      alertId: entry.id,
      alertCount: entry.alerts.length,
      subject: entry.content.subject,
    });

    return send(res, {
      status: 'pending_approval',
      alertId: entry.id,
      alerts: entry.alerts,
      channels: [],
      content: entry.content,
    });
  }

  // Gate off: unchanged pre-STORY-012 immediate-send behavior.
  const result = await sendKpiAlert(alerts, { generatedAt: current.generatedAt });

  if (result.reason === 'duplicate') {
    return send(res, {
      status: 'already_sent',
      alertId: result.alertId ?? null,
      alerts,
      channels: [],
      content: null,
    });
  }

  if (!result.sent) {
    return send(
      res,
      {
        status: 'send_failed',
        alertId: result.alertId ?? null,
        alerts,
        channels: result.channels,
        content: null,
      },
      502,
    );
  }

  return send(res, {
    status: 'sent',
    alertId: result.alertId ?? null,
    alerts,
    channels: result.channels,
    content: null,
  });
});

alertsRouter.post('/alerts/:id/approve', async (req: Request, res: Response) => {
  const correlationId = randomUUID();
  res.setHeader('X-Correlation-ID', correlationId);
  const { id } = req.params;

  const entry = getPendingById(id);
  if (!entry) {
    return sendError(res, 404, 'NotFound', `No pending alert found with id "${id}".`);
  }

  if (entry.status === 'rejected') {
    return sendError(
      res,
      409,
      'AlreadyRejected',
      `Alert "${id}" was already rejected and cannot be approved.`,
    );
  }

  if (entry.status === 'approved' && entry.sendResult) {
    // Idempotent: already approved once — return the cached outcome without
    // attempting a second send.
    logAlertEvent('info', {
      event: 'alert_approved',
      outcome: 'success',
      correlation_id: correlationId,
      alertId: id,
      reused: true,
    });
    return sendApproveResult(res, id, entry.alerts, entry.sendResult);
  }

  const result = await sendKpiAlert(entry.alerts, { generatedAt: entry.generatedAt });
  markApproved(id, result);

  logAlertEvent(result.sent ? 'info' : 'error', {
    event: 'alert_approved',
    outcome: result.sent ? 'success' : 'failure',
    correlation_id: correlationId,
    alertId: id,
    reused: false,
  });

  return sendApproveResult(res, id, entry.alerts, result);
});

alertsRouter.post('/alerts/:id/reject', (req: Request, res: Response) => {
  const correlationId = randomUUID();
  res.setHeader('X-Correlation-ID', correlationId);
  const { id } = req.params;

  const entry = getPendingById(id);
  if (!entry) {
    return sendError(res, 404, 'NotFound', `No pending alert found with id "${id}".`);
  }

  if (entry.status === 'approved') {
    return sendError(
      res,
      409,
      'AlreadyApproved',
      `Alert "${id}" was already approved and cannot be rejected.`,
    );
  }

  markRejected(id);

  logAlertEvent('info', {
    event: 'alert_rejected',
    outcome: 'success',
    correlation_id: correlationId,
    alertId: id,
  });

  const payload: RejectAlertResponse = { status: 'rejected', alertId: id };
  sendValidated(res, RejectAlertResponseSchema, 200, payload);
});

alertsRouter.get('/alerts/pending', (_req: Request, res: Response) => {
  const pending = listPending().map((e) => ({
    id: e.id,
    alerts: e.alerts,
    content: e.content,
    generatedAt: e.generatedAt,
  }));
  sendValidated(res, PendingAlertListResponseSchema, 200, { pending });
});

function sendApproveResult(
  res: Response,
  alertId: string,
  alerts: AlertRunResponse['alerts'],
  result: { sent: boolean; channels: AlertRunResponse['channels'] },
): void {
  const payload: ApproveAlertResponse = {
    status: result.sent ? 'sent' : 'send_failed',
    alertId,
    alerts,
    channels: result.channels,
  };
  sendValidated(res, ApproveAlertResponseSchema, result.sent ? 200 : 502, payload);
}

function sendError(
  res: Response,
  status: number,
  errorClass: AlertActionErrorResponse['errorClass'],
  message: string,
): void {
  sendValidated(res, AlertActionErrorResponseSchema, status, { status: 'error', errorClass, message });
}

function send(res: Response, body: Omit<AlertRunResponse, 'thresholdPct'>, status = 200): void {
  const payload: AlertRunResponse = { ...body, thresholdPct: ALERT_THRESHOLD_PCT };
  sendValidated(res, AlertRunResponseSchema, status, payload);
}
