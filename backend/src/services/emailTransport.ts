import { AlertContent, AlertTransport, logAlertDelivery } from './alertTransport';

/**
 * Email delivery for alerts (STORY-004).
 *
 * Walking skeleton: dry-run only. It logs the full alert content and returns
 * success, so the rest of the pipeline (detection, idempotency, audit) is
 * exercised end to end without a Mandrill key and without sending real mail.
 *
 * Harden pass (STORY-004 follow-up): when `MANDRILL_API_KEY` is set, return a
 * real transport that POSTs to
 *   https://mandrillapp.com/api/1.0/messages/send.json
 * with an explicit timeout + capped retry (via processingAudit.runStep), the
 * key read from env and redacted in every log line. Until that lands, a
 * key being present is logged loudly and still falls back to dry-run, so no
 * untested HTTP path ships and nothing is silently dropped.
 */

function dryRunEmailTransport(mode: string): AlertTransport {
  return {
    channel: 'email',
    mode,
    async send(content: AlertContent): Promise<void> {
      logAlertDelivery('email', mode, 'simulated', content);
    },
  };
}

export function createEmailTransport(): AlertTransport {
  if (process.env.MANDRILL_API_KEY) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'backend',
        event: 'alert_transport_config',
        channel: 'email',
        message:
          'MANDRILL_API_KEY is set but the real email adapter is not built yet (STORY-004 harden). Falling back to dry-run.',
      }),
    );
    return dryRunEmailTransport('email:dry-run(key-present)');
  }
  return dryRunEmailTransport('email:dry-run');
}
