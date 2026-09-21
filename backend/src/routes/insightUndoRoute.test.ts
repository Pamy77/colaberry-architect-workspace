import request from 'supertest';
import { createApp } from '../app';
import { clearLatest, setLatest } from '../services/latestKpiStore';
import { clearFeedback, getFeedback } from '../services/feedbackStore';
import { clearVersions } from '../services/insightVersionStore';
import type { KpiCalculation } from '../services/kpiService';

function silenceLogs(): jest.SpyInstance {
  return jest.spyOn(console, 'log').mockImplementation(() => undefined);
}

function calc(): KpiCalculation {
  return {
    status: 'ok',
    kpis: [
      {
        key: 'business.revenue.total',
        label: 'Total revenue',
        value: 5000,
        unit: 'currency',
        evidenceLevel: 'high',
        evidenceNote: 'note',
        basis: { column: 'revenue', rowsConsidered: 5, rowsUsed: 5, coverage: 1 },
      },
    ],
    clarificationsNeeded: [],
    summary: { totalDataRows: 5, cleanedRowCount: 5, flaggedRowCount: 0, numericColumns: ['revenue'] },
  };
}

describe('POST /api/insights/undo', () => {
  beforeEach(() => {
    clearLatest();
    clearFeedback();
    clearVersions();
  });

  it('is irreversible when nothing has ever changed for this insight', async () => {
    silenceLogs();
    const res = await request(createApp())
      .post('/api/insights/undo')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('irreversible');
  });

  it('restores the previous state after two real changes (acceptance #2)', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });
    const app = createApp();

    await request(app).post('/api/insights/feedback').send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    await request(app).post('/api/insights/feedback').send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'inaccurate' });

    const res = await request(app).post('/api/insights/undo').send({ kpiKey: 'business.revenue.total', generatedAt: 'T1' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('restored');
    expect(res.body.restoredRating).toBe('accurate');
    expect(getFeedback('business.revenue.total', 'T1')?.rating).toBe('accurate');
  });

  it('a single change (the first-ever) is irreversible — nothing before it', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });
    const app = createApp();

    await request(app).post('/api/insights/feedback').send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    const res = await request(app).post('/api/insights/undo').send({ kpiKey: 'business.revenue.total', generatedAt: 'T1' });

    expect(res.body.outcome).toBe('irreversible');
  });

  it('a malformed body (missing generatedAt) is a 400', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/insights/undo').send({ kpiKey: 'business.revenue.total' });
    expect(res.status).toBe(400);
  });

  it('carries a correlation id in the header matching the body', async () => {
    silenceLogs();
    const res = await request(createApp())
      .post('/api/insights/undo')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1' });

    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });
});
