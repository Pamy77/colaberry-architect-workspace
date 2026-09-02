/**
 * Shared types + helper for alert delivery channels (STORY-004 / REQ-005).
 *
 * A transport delivers one piece of alert content over one channel. The
 * notification service owns *what* to send and *whether* it was sent; a
 * transport only knows *how* to put it on the wire (or, for now, how to
 * simulate that).
 */

export interface AlertContent {
  subject: string;
  bodyText: string;
  alertCount: number;
}

export interface AlertTransport {
  readonly channel: 'email' | 'slack';
  /** Short description of the delivery mode, for logs (e.g. "email:dry-run"). */
  readonly mode: string;
  send(content: AlertContent): Promise<void>;
}

/**
 * One structured line per delivery attempt. Carries the subject and a body
 * preview so a dry-run leaves a real record of what would have gone out — part
 * of the STORY-004 Trust criterion ("logs all alerts sent and their contents").
 */
export function logAlertDelivery(
  channel: string,
  mode: string,
  outcome: 'simulated' | 'sent' | 'failed',
  content: AlertContent,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'failed' ? 'error' : 'info',
      service: 'backend',
      event: 'alert_delivery',
      channel,
      mode,
      outcome,
      subject: content.subject,
      bodyPreview: content.bodyText.slice(0, 500),
      alertCount: content.alertCount,
    }),
  );
}
