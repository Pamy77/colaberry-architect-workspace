import request from 'supertest';
import { createApp } from '../app';
import * as latestKpiStore from '../services/latestKpiStore';
import { clearLatest } from '../services/latestKpiStore';

/** Parse the structured JSON audit lines captured by a console.log spy. */
function auditLines(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(call[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

const SALES_CSV = 'month,revenue,expenses\nJan,1000,600\nFeb,1200,700\n';

describe('GET /api/kpis (dashboard data)', () => {
  beforeEach(() => clearLatest());
  afterEach(() => jest.restoreAllMocks());

  it('returns no_data before anything has been calculated', async () => {
    const res = await request(createApp()).get('/api/kpis');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'no_data', generatedAt: null });
  });

  it('returns the latest KPIs after an upload', async () => {
    const app = createApp();
    await request(app)
      .post('/api/upload')
      .attach('file', Buffer.from(SALES_CSV), { filename: 'sales.csv', contentType: 'text/csv' });

    const res = await request(app).get('/api/kpis');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.filename).toBe('sales.csv');
    expect(new Date(res.body.generatedAt).toString()).not.toBe('Invalid Date');
    expect(res.body.summary.numericColumns).toEqual(expect.arrayContaining(['revenue', 'expenses']));

    const revenueTotal = res.body.kpis.find((k: { key: string }) => k.key === 'business.revenue.total');
    expect(revenueTotal.value).toBe(2200);
    expect(revenueTotal.evidenceLevel).toBe('high');
  });

  it('logs a dashboard_access audit line with a correlation id on every request', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const res = await request(createApp()).get('/api/kpis');

      const correlationId = res.headers['x-correlation-id'];
      expect(correlationId).toMatch(/[0-9a-f-]{36}/);

      const line = auditLines(logSpy).find((l) => l.event === 'dashboard_access');
      expect(line).toBeDefined();
      expect(line?.correlation_id).toBe(correlationId);
      expect(line?.outcome).toBe('success');
      expect((line?.context as Record<string, unknown>).hasData).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('returns a typed 500 and logs a failure when the store read throws (dashboard fails to load)', async () => {
    jest.spyOn(latestKpiStore, 'getLatest').mockImplementation(() => {
      throw new Error('store read failed');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const res = await request(createApp()).get('/api/kpis');

      expect(res.status).toBe(500);
      expect(res.body.status).toBe('error');
      expect(res.body.errorClass).toBe('DashboardUnavailable');

      const line = auditLines(logSpy).find(
        (l) => l.event === 'dashboard_access' && l.outcome === 'failure',
      );
      expect(line).toBeDefined();
    } finally {
      logSpy.mockRestore();
    }
  });
});
