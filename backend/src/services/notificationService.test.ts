import fs from 'fs';
import path from 'path';
import {
  buildAlertContent,
  deriveAlertKey,
  sendKpiAlert,
  _clearSentAlerts,
} from './notificationService';
import type { AlertTransport } from './alertTransport';
import { detectKpiAlerts } from './alertDetectionService';
import type { KpiAlert } from './alertDetectionService';
import { cleanFile } from './dataCleaningService';
import { calculateKpis } from './kpiService';
import type { Kpi } from './kpiService';

function alert(overrides: Partial<KpiAlert> & Pick<KpiAlert, 'key'>): KpiAlert {
  return {
    label: overrides.key,
    unit: 'number',
    previousValue: 100,
    currentValue: 130,
    absoluteChange: 30,
    percentChange: 30,
    direction: 'increase',
    evidenceLevel: 'high',
    thresholdPct: 15,
    reason: `${overrides.label ?? overrides.key} rose 30% (100 → 130)`,
    ...overrides,
  };
}

function auditLines(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

const noSleep = () => Promise.resolve();

function recordingTransport(channel: 'email' | 'slack'): AlertTransport & { calls: number } {
  return {
    channel,
    mode: `${channel}:test`,
    calls: 0,
    async send() {
      this.calls += 1;
    },
  };
}

beforeEach(() => _clearSentAlerts());
afterEach(() => jest.restoreAllMocks());

describe('buildAlertContent', () => {
  it('summarises a single change', () => {
    const content = buildAlertContent([alert({ key: 'business.revenue.total', label: 'Total revenue' })]);
    expect(content.subject).toBe('KPI alert: 1 significant change');
    expect(content.alertCount).toBe(1);
    expect(content.bodyText).toContain('- Total revenue rose 30% (100 → 130)');
    expect(content.bodyText).toContain('Open your dashboard');
  });

  it('summarises several changes and flags low-confidence ones', () => {
    const content = buildAlertContent([
      alert({ key: 'a', label: 'Revenue' }),
      alert({ key: 'b', label: 'Margin', evidenceLevel: 'low', reason: 'Margin fell 40% (0.5 → 0.3)' }),
    ]);
    expect(content.subject).toBe('KPI alert: 2 significant changes');
    expect(content.bodyText).toContain('- Margin fell 40% (0.5 → 0.3) (low confidence)');
  });
});

describe('deriveAlertKey', () => {
  it('is stable for the same changes and generatedAt, regardless of order', () => {
    const a = [alert({ key: 'a' }), alert({ key: 'b' })];
    const b = [alert({ key: 'b' }), alert({ key: 'a' })];
    expect(deriveAlertKey(a, 'T1')).toBe(deriveAlertKey(b, 'T1'));
    expect(deriveAlertKey(a, 'T1')).not.toBe(deriveAlertKey(a, 'T2'));
  });
});

describe('sendKpiAlert', () => {
  it('sends nothing and reports no_significant_changes for an empty alert list', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await sendKpiAlert([]);

    expect(result).toEqual({ sent: false, reason: 'no_significant_changes', channels: [] });
    expect(auditLines(logSpy).some((l) => l.event === 'alert_sent')).toBe(false);
  });

  it('delivers the alert content to every channel and logs alert_sent with the body', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const email = recordingTransport('email');
    const slack = recordingTransport('slack');

    const result = await sendKpiAlert([alert({ key: 'business.revenue.total', label: 'Total revenue' })], {
      transports: [email, slack],
      generatedAt: 'T1',
    });

    expect(result.sent).toBe(true);
    expect(email.calls).toBe(1);
    expect(slack.calls).toBe(1);
    expect(result.channels).toEqual([
      { channel: 'email', mode: 'email:test', outcome: 'sent' },
      { channel: 'slack', mode: 'slack:test', outcome: 'sent' },
    ]);

    const sentLine = auditLines(logSpy).find((l) => l.event === 'alert_sent');
    expect(sentLine).toBeDefined();
    expect(sentLine?.outcome).toBe('success');
    expect(sentLine?.body).toContain('Total revenue rose 30%');
    expect(sentLine?.alertId).toBe(result.alertId);
  });

  it('does not send the same alert twice (idempotent)', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const email = recordingTransport('email');
    const changes = [alert({ key: 'k' })];

    const first = await sendKpiAlert(changes, { transports: [email], generatedAt: 'T1' });
    const second = await sendKpiAlert(changes, { transports: [email], generatedAt: 'T1' });

    expect(first.sent).toBe(true);
    expect(second).toMatchObject({ sent: false, reason: 'duplicate', alertId: first.alertId });
    expect(email.calls).toBe(1); // second call never reached the transport
  });

  it('retries a failing channel, then records the failure without remembering it', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    let calls = 0;
    const flaky: AlertTransport = {
      channel: 'email',
      mode: 'email:test',
      async send() {
        calls += 1;
        throw new Error('smtp unavailable');
      },
    };

    const result = await sendKpiAlert([alert({ key: 'k' })], {
      transports: [flaky],
      generatedAt: 'T1',
      retries: 2,
      sleep: noSleep,
    });

    expect(calls).toBe(3); // first attempt + 2 retries
    expect(result.sent).toBe(false);
    expect(result.channels[0]).toMatchObject({ outcome: 'failed', error: 'smtp unavailable' });

    const sentLine = auditLines(logSpy).find((l) => l.event === 'alert_sent');
    expect(sentLine?.outcome).toBe('failure');

    // Not remembered: a retry of the same alert is allowed to try again.
    const retry = await sendKpiAlert([alert({ key: 'k' })], {
      transports: [flaky],
      generatedAt: 'T1',
      retries: 0,
      sleep: noSleep,
    });
    expect(retry.reason).not.toBe('duplicate');
    expect(calls).toBe(4);
  });

  it('counts a partial success (one channel delivered) as sent, and dedupes afterwards', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const email = recordingTransport('email');
    const slack: AlertTransport = {
      channel: 'slack',
      mode: 'slack:test',
      async send() {
        throw new Error('slack 500');
      },
    };

    const result = await sendKpiAlert([alert({ key: 'k' })], {
      transports: [email, slack],
      generatedAt: 'T1',
      retries: 0,
      sleep: noSleep,
    });

    expect(result.sent).toBe(true);
    expect(result.channels.map((c) => c.outcome)).toEqual(['sent', 'failed']);

    const again = await sendKpiAlert([alert({ key: 'k' })], {
      transports: [email, slack],
      generatedAt: 'T1',
    });
    expect(again.reason).toBe('duplicate');
  });

  it('uses the real dry-run email + slack transports by default', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await sendKpiAlert([alert({ key: 'k' })], { generatedAt: 'T1' });

    expect(result.sent).toBe(true);
    expect(result.channels.map((c) => c.channel)).toEqual(['email', 'slack']);
    expect(result.channels.every((c) => c.outcome === 'sent')).toBe(true);
    expect(result.channels.every((c) => c.mode.includes('dry-run'))).toBe(true);

    const deliveries = auditLines(logSpy).filter((l) => l.event === 'alert_delivery');
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d) => d.outcome === 'simulated')).toBe(true);
  });
});

// Walking-skeleton stage 3 (alert-insight-agent): proves the new stage-2
// sales-trend KPI (business.revenue.trend.momAvg) genuinely flows end to
// end -- real stage-2 output (via cleanFile + calculateKpis against the
// stage-1 fixture, not hand-typed) through detection into drafted alert
// content, including the medium-confidence caveat buildAlertContent already
// appends for a non-'high' evidenceLevel.
describe('business.revenue.trend.momAvg end-to-end (stage 2 -> stage 3 handoff)', () => {
  it('detects the real trend KPI crossing the threshold and drafts content with the medium-confidence caveat', async () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'sampleSales.csv');
    const buffer = fs.readFileSync(fixturePath);
    const cleaned = await cleanFile(buffer, 'sampleSales.csv');
    const calc = calculateKpis(cleaned);

    const currentTrend = calc.kpis.find((k) => k.key === 'business.revenue.trend.momAvg');
    expect(currentTrend).toBeDefined(); // sanity: stage 2 really produced the KPI
    expect(currentTrend?.value).toBeCloseTo(0.2349, 4);
    expect(currentTrend?.evidenceLevel).toBe('medium');

    // Previous calculation's trend reading: a materially smaller
    // month-over-month average (0.05, high confidence) so the move to 0.2349
    // clears ALERT_THRESHOLD_PCT (default 15%) by a wide margin (~370%).
    const previousTrend: Kpi = {
      key: 'business.revenue.trend.momAvg',
      label: currentTrend!.label,
      value: 0.05,
      unit: 'ratio',
      evidenceLevel: 'high',
      evidenceNote: 'Prior calculation baseline for this test.',
      basis: { column: 'revenue', rowsConsidered: 8, rowsUsed: 8, coverage: 1 },
    };

    const alerts = detectKpiAlerts([previousTrend], calc.kpis);
    const trendAlert = alerts.find((a) => a.key === 'business.revenue.trend.momAvg');

    expect(trendAlert).toBeDefined();
    expect(trendAlert?.direction).toBe('increase');
    expect(trendAlert?.previousValue).toBe(0.05);
    expect(trendAlert?.currentValue).toBeCloseTo(0.2349, 4);
    // weaker of (previous 'high', current 'medium') = 'medium'
    expect(trendAlert?.evidenceLevel).toBe('medium');

    const content = buildAlertContent([trendAlert!]);
    expect(content.bodyText).toContain('Sales trend (avg. month-over-month revenue change)');
    expect(content.bodyText).toContain('(medium confidence)');
  });
});
