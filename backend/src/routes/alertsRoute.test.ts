import request from 'supertest';
import { createApp } from '../app';
import { clearLatest, setLatest } from '../services/latestKpiStore';
import { _clearSentAlerts } from '../services/notificationService';
import * as notificationService from '../services/notificationService';
import { clearPendingAlerts } from '../services/pendingAlertStore';
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

/** Seeds a baseline + a +40% significant move, ready to trigger an alert. */
function seedSignificantChange(): void {
  seed([kpi('revenue', 1000)], 'T1');
  seed([kpi('revenue', 1400)], 'T2'); // +40%
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

describe('POST /api/alerts/run (ALERT_REQUIRE_APPROVAL default: on)', () => {
  beforeEach(() => {
    clearLatest();
    _clearSentAlerts();
    clearPendingAlerts();
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns no_data when nothing has been calculated', async () => {
    const res = await request(createApp()).post('/api/alerts/run');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'no_data',
      alertId: null,
      alerts: [],
      channels: [],
      content: null,
    });
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

  it('drafts a pending_approval alert when a KPI moves significantly, and does not send', async () => {
    const logSpy = silenceLogs();
    const sendSpy = jest.spyOn(notificationService, 'sendKpiAlert');
    seedSignificantChange();

    const res = await request(createApp()).post('/api/alerts/run');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.alertId).toEqual(expect.any(String));
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0]).toMatchObject({ key: 'revenue', direction: 'increase', percentChange: 40 });
    expect(res.body.channels).toEqual([]);
    expect(res.body.content).toMatchObject({ subject: expect.stringContaining('KPI alert') });
    expect(res.body.content.bodyText).toContain('revenue rose 40%');

    // The gate's entire point: no send happens on detection alone.
    expect(sendSpy).not.toHaveBeenCalled();

    const pendingLine = auditLines(logSpy).find((l) => l.event === 'pending_approval');
    expect(pendingLine?.outcome).toBe('success');
    expect(pendingLine?.alertId).toBe(res.body.alertId);
  });

  it('is idempotent: a second run for the same change finds the existing pending entry instead of drafting a duplicate', async () => {
    silenceLogs();
    seedSignificantChange();
    const app = createApp();

    const first = await request(app).post('/api/alerts/run');
    const second = await request(app).post('/api/alerts/run');

    expect(first.body.status).toBe('pending_approval');
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('pending_approval');
    expect(second.body.alertId).toBe(first.body.alertId);

    const pendingRes = await request(app).get('/api/alerts/pending');
    expect(pendingRes.body.pending).toHaveLength(1); // not two
  });
});

describe('POST /api/alerts/:id/approve, /reject, GET /api/alerts/pending', () => {
  beforeEach(() => {
    clearLatest();
    _clearSentAlerts();
    clearPendingAlerts();
  });
  afterEach(() => jest.restoreAllMocks());

  async function draftPendingAlert(app: ReturnType<typeof createApp>): Promise<string> {
    seedSignificantChange();
    const res = await request(app).post('/api/alerts/run');
    expect(res.body.status).toBe('pending_approval');
    return res.body.alertId as string;
  }

  it('happy path: pending_approval -> GET pending lists it -> approve -> sent, and it drops off the pending list', async () => {
    silenceLogs();
    const app = createApp();
    const id = await draftPendingAlert(app);

    const beforeApprove = await request(app).get('/api/alerts/pending');
    expect(beforeApprove.body.pending).toHaveLength(1);
    expect(beforeApprove.body.pending[0]).toMatchObject({ id, generatedAt: 'T2' });

    const approveRes = await request(app).post(`/api/alerts/${id}/approve`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('sent');
    expect(approveRes.body.alertId).toBe(id);
    expect(approveRes.body.channels.every((c: { outcome: string }) => c.outcome === 'sent')).toBe(true);

    const afterApprove = await request(app).get('/api/alerts/pending');
    expect(afterApprove.body.pending).toEqual([]);
  });

  it('reject path: pending -> reject -> drops off pending list -> approving after reject is refused as a 4xx, never sends', async () => {
    silenceLogs();
    const sendSpy = jest.spyOn(notificationService, 'sendKpiAlert');
    const app = createApp();
    const id = await draftPendingAlert(app);

    const rejectRes = await request(app).post(`/api/alerts/${id}/reject`);
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body).toEqual({ status: 'rejected', alertId: id });

    const pendingRes = await request(app).get('/api/alerts/pending');
    expect(pendingRes.body.pending).toEqual([]);

    // Rejecting twice is idempotent, not an error.
    const rejectAgain = await request(app).post(`/api/alerts/${id}/reject`);
    expect(rejectAgain.status).toBe(200);
    expect(rejectAgain.body).toEqual({ status: 'rejected', alertId: id });

    const approveAfterReject = await request(app).post(`/api/alerts/${id}/approve`);
    expect(approveAfterReject.status).toBe(409);
    expect(approveAfterReject.body).toMatchObject({ status: 'error', errorClass: 'AlreadyRejected' });

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('double-approve idempotency: approving twice does not send twice and returns the same result', async () => {
    silenceLogs();
    const sendSpy = jest.spyOn(notificationService, 'sendKpiAlert');
    const app = createApp();
    const id = await draftPendingAlert(app);

    const first = await request(app).post(`/api/alerts/${id}/approve`);
    const second = await request(app).post(`/api/alerts/${id}/approve`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('unknown id: approve and reject both return a clear 404, not a silent no-op', async () => {
    const app = createApp();

    const approveRes = await request(app).post('/api/alerts/does-not-exist/approve');
    expect(approveRes.status).toBe(404);
    expect(approveRes.body).toMatchObject({ status: 'error', errorClass: 'NotFound' });

    const rejectRes = await request(app).post('/api/alerts/does-not-exist/reject');
    expect(rejectRes.status).toBe(404);
    expect(rejectRes.body).toMatchObject({ status: 'error', errorClass: 'NotFound' });
  });

  it('send target unreachable: approve returns 502 send_failed when every channel fails, and a second approve reuses that outcome without re-sending', async () => {
    silenceLogs();
    const sendSpy = jest
      .spyOn(notificationService, 'sendKpiAlert')
      .mockResolvedValue({
        sent: false,
        alertId: 'unused-because-route-supplies-its-own-id',
        channels: [{ channel: 'email', mode: 'email:test', outcome: 'failed', error: 'smtp down' }],
      });
    const app = createApp();
    const id = await draftPendingAlert(app);

    const res = await request(app).post(`/api/alerts/${id}/approve`);
    expect(res.status).toBe(502);
    expect(res.body.status).toBe('send_failed');
    expect(res.body.channels[0]).toMatchObject({ outcome: 'failed', error: 'smtp down' });

    const second = await request(app).post(`/api/alerts/${id}/approve`);
    expect(second.status).toBe(502);
    expect(second.body).toEqual(res.body);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('GET /api/alerts/pending returns an empty list when nothing is pending', async () => {
    const res = await request(createApp()).get('/api/alerts/pending');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: [] });
  });
});

describe('POST /api/alerts/run with ALERT_REQUIRE_APPROVAL=false (no regression vs pre-STORY-012 behavior)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends immediately, dedupes a replay as already_sent, and reports 502 on total delivery failure — exactly like before the gate existed', async () => {
    const logSpy = silenceLogs();
    const prevEnv = process.env.ALERT_REQUIRE_APPROVAL;
    process.env.ALERT_REQUIRE_APPROVAL = 'false';

    let createAppIsolated!: typeof import('../app').createApp;
    let setLatestIsolated!: typeof import('../services/latestKpiStore').setLatest;
    let clearLatestIsolated!: typeof import('../services/latestKpiStore').clearLatest;

    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const appMod = require('../app') as typeof import('../app');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const storeMod = require('../services/latestKpiStore') as typeof import('../services/latestKpiStore');
        createAppIsolated = appMod.createApp;
        setLatestIsolated = storeMod.setLatest;
        clearLatestIsolated = storeMod.clearLatest;
      });

      clearLatestIsolated();
      const app = createAppIsolated();
      setLatestIsolated({ result: calc([kpi('revenue', 1000)]), filename: 'f.csv', generatedAt: 'T1' });
      setLatestIsolated({ result: calc([kpi('revenue', 1400)]), filename: 'f.csv', generatedAt: 'T2' });

      const first = await request(app).post('/api/alerts/run');
      expect(first.status).toBe(200);
      expect(first.body.status).toBe('sent');
      expect(first.body.content).toBeNull();
      expect(first.body.channels.every((c: { outcome: string }) => c.outcome === 'sent')).toBe(true);

      const second = await request(app).post('/api/alerts/run');
      expect(second.status).toBe(200);
      expect(second.body.status).toBe('already_sent');
      expect(second.body.alertId).toBe(first.body.alertId);
      expect(second.body.channels).toEqual([]);

      const sentLine = auditLines(logSpy).find((l) => l.event === 'alert_sent');
      expect(sentLine?.outcome).toBe('success');
      expect(sentLine?.body).toContain('revenue rose 40%');
    } finally {
      if (prevEnv === undefined) delete process.env.ALERT_REQUIRE_APPROVAL;
      else process.env.ALERT_REQUIRE_APPROVAL = prevEnv;
    }
  });

  it('returns 502 send_failed when every channel fails (email delivery failure), gate off', async () => {
    silenceLogs();
    const prevEnv = process.env.ALERT_REQUIRE_APPROVAL;
    process.env.ALERT_REQUIRE_APPROVAL = 'false';

    let createAppIsolated!: typeof import('../app').createApp;
    let setLatestIsolated!: typeof import('../services/latestKpiStore').setLatest;
    let clearLatestIsolated!: typeof import('../services/latestKpiStore').clearLatest;
    let notificationModIsolated!: typeof import('../services/notificationService');

    try {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const appMod = require('../app') as typeof import('../app');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const storeMod = require('../services/latestKpiStore') as typeof import('../services/latestKpiStore');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        notificationModIsolated = require('../services/notificationService') as typeof import('../services/notificationService');
        createAppIsolated = appMod.createApp;
        setLatestIsolated = storeMod.setLatest;
        clearLatestIsolated = storeMod.clearLatest;
      });

      clearLatestIsolated();
      jest.spyOn(notificationModIsolated, 'sendKpiAlert').mockResolvedValue({
        sent: false,
        alertId: 'abc123',
        channels: [{ channel: 'email', mode: 'email:test', outcome: 'failed', error: 'smtp down' }],
      });

      const app = createAppIsolated();
      setLatestIsolated({ result: calc([kpi('revenue', 1000)]), filename: 'f.csv', generatedAt: 'T1' });
      setLatestIsolated({ result: calc([kpi('revenue', 1400)]), filename: 'f.csv', generatedAt: 'T2' });

      const res = await request(app).post('/api/alerts/run');

      expect(res.status).toBe(502);
      expect(res.body.status).toBe('send_failed');
      expect(res.body.alertId).toBe('abc123');
      expect(res.body.channels[0]).toMatchObject({ outcome: 'failed', error: 'smtp down' });
    } finally {
      if (prevEnv === undefined) delete process.env.ALERT_REQUIRE_APPROVAL;
      else process.env.ALERT_REQUIRE_APPROVAL = prevEnv;
    }
  });
});
