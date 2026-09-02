import { createHash } from 'crypto';
import { newRun, runStep } from './processingAudit';
import type { KpiAlert } from './alertDetectionService';
import type { AlertContent, AlertTransport } from './alertTransport';
import { createEmailTransport } from './emailTransport';
import { createSlackTransport } from './slackTransport';

/**
 * Turns detected KPI alerts into delivered notifications (STORY-004 / REQ-005).
 *
 *  - `buildAlertContent` — deterministic subject + body from the alert list.
 *  - `sendKpiAlert` — dedupes, fans out to the channel transports (each send
 *    wrapped in processingAudit.runStep for an explicit timeout + capped
 *    retry), and writes one `alert_sent` audit line carrying the full content
 *    (STORY-004 Trust criterion: "logs all alerts sent and their contents").
 *
 * Idempotent: the same set of changes for the same calculation is sent once.
 * A run where *every* channel failed is not remembered, so a later retry can
 * try again.
 */

export interface AlertChannelResult {
  channel: string;
  mode: string;
  outcome: 'sent' | 'failed';
  error?: string;
}

export interface SendAlertResult {
  sent: boolean;
  reason?: 'no_significant_changes' | 'duplicate';
  alertId?: string;
  content?: AlertContent;
  channels: AlertChannelResult[];
}

export interface SendAlertOptions {
  /** Defaults to the configured email + slack transports. Overridable for tests. */
  transports?: AlertTransport[];
  /** Folded into the idempotency key so a new calculation can re-alert. */
  generatedAt?: string;
  sendTimeoutMs?: number;
  /** Retries per channel after the first attempt. Default 2. */
  retries?: number;
  /** Test seam for backoff between retries. */
  sleep?: (ms: number) => Promise<void>;
}

const DEDUP_MAX = process.env.ALERT_DEDUP_CACHE_SIZE
  ? Number(process.env.ALERT_DEDUP_CACHE_SIZE)
  : 256;

const sentAlertKeys = new Set<string>();

function rememberSent(key: string): void {
  sentAlertKeys.add(key);
  while (sentAlertKeys.size > Math.max(1, DEDUP_MAX)) {
    const oldest = sentAlertKeys.values().next().value;
    if (oldest === undefined) break;
    sentAlertKeys.delete(oldest);
  }
}

/** Test seam: clear the in-process sent-alert dedup set. */
export function _clearSentAlerts(): void {
  sentAlertKeys.clear();
}

export function buildAlertContent(alerts: KpiAlert[]): AlertContent {
  const n = alerts.length;
  const subject = `KPI alert: ${n} significant change${n === 1 ? '' : 's'}`;
  const lines = alerts.map((a) => {
    const caveat = a.evidenceLevel === 'high' ? '' : ` (${a.evidenceLevel} confidence)`;
    return `- ${a.reason}${caveat}`;
  });
  const bodyText = [
    `${n} of your KPIs moved significantly since the last calculation:`,
    '',
    ...lines,
    '',
    'Open your dashboard to review the details.',
  ].join('\n');
  return { subject, bodyText, alertCount: n };
}

export function deriveAlertKey(alerts: KpiAlert[], generatedAt: string): string {
  const canonical = alerts
    .map((a) => `${a.key}:${a.previousValue}->${a.currentValue}`)
    .sort()
    .join(',');
  return createHash('sha256').update(generatedAt).update('|').update(canonical).digest('hex');
}

function logAlertEvent(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'backend', ...fields }),
  );
}

export async function sendKpiAlert(
  alerts: KpiAlert[],
  options: SendAlertOptions = {},
): Promise<SendAlertResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  if (alerts.length === 0) {
    logAlertEvent('info', {
      event: 'alert_check',
      outcome: 'success',
      sent: false,
      reason: 'no_significant_changes',
      alertCount: 0,
    });
    return { sent: false, reason: 'no_significant_changes', channels: [] };
  }

  const alertId = deriveAlertKey(alerts, generatedAt);

  if (sentAlertKeys.has(alertId)) {
    logAlertEvent('info', {
      event: 'alert_check',
      outcome: 'success',
      sent: false,
      reason: 'duplicate',
      alertId,
      alertCount: alerts.length,
    });
    return { sent: false, reason: 'duplicate', alertId, channels: [] };
  }

  const content = buildAlertContent(alerts);
  const transports = options.transports ?? [createEmailTransport(), createSlackTransport()];
  const run = newRun();

  const channels: AlertChannelResult[] = [];
  for (const transport of transports) {
    try {
      await runStep(run, `send_${transport.channel}`, () => transport.send(content), {
        timeoutMs: options.sendTimeoutMs ?? 10_000,
        retries: options.retries ?? 2,
        sleep: options.sleep,
        context: { channel: transport.channel, mode: transport.mode },
      });
      channels.push({ channel: transport.channel, mode: transport.mode, outcome: 'sent' });
    } catch (err) {
      channels.push({
        channel: transport.channel,
        mode: transport.mode,
        outcome: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  const anySent = channels.some((c) => c.outcome === 'sent');
  if (anySent) rememberSent(alertId);

  logAlertEvent(anySent ? 'info' : 'error', {
    event: 'alert_sent',
    outcome: anySent ? 'success' : 'failure',
    correlation_id: run.runId,
    alertId,
    alertCount: alerts.length,
    subject: content.subject,
    body: content.bodyText,
    channels: channels.map((c) => ({ channel: c.channel, mode: c.mode, outcome: c.outcome })),
  });

  return { sent: anySent, alertId, content, channels };
}
