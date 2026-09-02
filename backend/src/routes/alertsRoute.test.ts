import request from 'supertest';
import { createApp } from '../app';
import { clearLatest, setLatest } from '../services/latestKpiStore';
import { _clearSentAlerts } from '../services/notificationService';
import * as notificationService from '../services/notificationService';
import type { KpiCalculation, Kpi } from '../services/kpiService';

function kpi(key: string, value: number): Kpi {
  return {
    key,
    label: key,
    value,
    unit: 'number',
    evidenceLevel: 'high',
    evidenceNote: '',
    basis: { column: null, rowsConsidered: 0, rowsUsed: 0, coverage: 0 },
  };
}

function calc(kpis: Kpi[]): KpiCalculation {
  return {
    status: 'ok',
    kpis,
    clarificationsNeeded: [],
    summary: { totalDataRows: 0, cleanedRowCount: 0, flaggedRowCount: 0, numericColumns: [] },
  };
}

function seed(kpis: Kpi[], generatedAt: string): void {
  setLatest({ result: calc(kpis), filename: 'f.csv', generatedAt });
}

function silenceLogs(): jest.SpyInstance {
  return jest.spyOn(console, 'log').mockImplementation(() => undefined);
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

describe('POST /api/alerts/run', () => {
  beforeEach(() => {
    clearLatest();
    _clearSentAlerts();
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns no_data when nothing has been calculated', async () => {
    const res = await request(createApp()).post('/api/alerts/run');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'no_data', alertId: null, alerts: [], channels: [] });
    expect(res.body.thresholdPct).toBe(15);
    expect(res.headers['x-correlation-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('returns no_baseline after only one calculation', async () => {
    seed([kpi('revenue', 1000)], 'T1');
    const res = await request(createApp()).post('/api/alerts/run');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_baseline');
  });

  it('returns no_changes when nothing crossed the threshold', async () => {
    seed([kpi('revenue', 1000)], 'T1');
    seed([kpi('revenue', 1050)], 'T2'); // +5%
    const res = await request(createApp()).post('/api/alerts/run');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_changes');
    expect(res.body.alerts).toEqual([]);
  });

  it('sends an alert when a KPI moves significantly, and logs its contents', async () => {
    const logSpy = silenceLogs();
    seed([kpi('revenue', 1000)], 'T1');
    seed([kpi('revenue', 1400)], 'T2'); // +40%

    const res = await request(createApp()).post('/api/alerts/run');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(res.body.alertId).toEqual(expect.any(String));
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0]).toMatchObject({ key: 'revenue', direction: 'increase', percentChange: 40 });
    expect(res.body.channels.map((c: { channel: string }) => c.channel)).toEqual(['email', 'slack']);
    expect(res.body.channels.every((c: { outcome: string }) => c.outcome === 'sent')).toBe(true);

    const sentLine = auditLines(logSpy).find((l) => l.event === 'alert_sent');
    expect(sentLine?.outcome).toBe('success');
    expect(sentLine?.body).toContain('revenue rose 40%');
  });

  it('is idempotent: a second run for the same change reports already_sent', async () => {
    silenceLogs();
    seed([kpi('revenue', 1000)], 'T1');
    seed([kpi('revenue', 1400)], 'T2');
    const app = createApp();

    const first = await request(app).post('/api/alerts/run');
    const second = await request(app).post('/api/alerts/run');

    expect(first.body.status).toBe('sent');
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('already_sent');
    expect(second.body.alertId).toBe(first.body.alertId);
    expect(second.body.channels).toEqual([]);
  });

  it('returns 502 send_failed when every channel fails (email delivery failure)', async () => {
    silenceLogs();
    jest.spyOn(notificationService, 'sendKpiAlert').mockResolvedValue({
      sent: false,
      alertId: 'abc123',
      channels: [{ channel: 'email', mode: 'email:test', outcome: 'failed', error: 'smtp down' }],
    });
    seed([kpi('revenue', 1000)], 'T1');
    seed([kpi('revenue', 1400)], 'T2');

    const res = await request(createApp()).post('/api/alerts/run');

    expect(res.status).toBe(502);
    expect(res.body.status).toBe('send_failed');
    expect(res.body.alertId).toBe('abc123');
    expect(res.body.channels[0]).toMatchObject({ outcome: 'failed', error: 'smtp down' });
  });
});
