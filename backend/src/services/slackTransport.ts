import { AlertContent, AlertTransport, logAlertDelivery } from './alertTransport';

/**
 * Slack delivery for alerts (STORY-004 / REQ-005 names email *and* Slack).
 *
 * Same walking-skeleton shape as emailTransport: dry-run only. Harden pass:
 * when `SLACK_WEBHOOK_URL` is set, POST the alert text to that incoming-webhook
 * URL with an explicit timeout + capped retry. Until then a configured URL is
 * logged and delivery still falls back to dry-run.
 */

function dryRunSlackTransport(mode: string): AlertTransport {
  return {
    channel: 'slack',
    mode,
    async send(content: AlertContent): Promise<void> {
      logAlertDelivery('slack', mode, 'simulated', content);
    },
  };
}

export function createSlackTransport(): AlertTransport {
  if (process.env.SLACK_WEBHOOK_URL) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'backend',
        event: 'alert_transport_config',
        channel: 'slack',
        message:
          'SLACK_WEBHOOK_URL is set but the real Slack adapter is not built yet (STORY-004 harden). Falling back to dry-run.',
      }),
    );
    return dryRunSlackTransport('slack:dry-run(url-present)');
  }
  return dryRunSlackTransport('slack:dry-run');
}
