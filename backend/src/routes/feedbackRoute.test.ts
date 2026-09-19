import request from 'supertest';
import { createApp } from '../app';
import { clearLatest, setLatest } from '../services/latestKpiStore';
import { clearFeedback } from '../services/feedbackStore';
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

describe('POST /api/insights/feedback', () => {
  beforeEach(() => {
    clearLatest();
    clearFeedback();
  });

  it('records feedback on a real insight, 200', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });

    const res = await request(createApp())
      .post('/api/insights/feedback')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('recorded');
    expect(res.body.entry.rating).toBe('accurate');
  });

  it('an unknown insight is 404, insight_not_found', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });

    const res = await request(createApp())
      .post('/api/insights/feedback')
      .send({ kpiKey: 'not.a.real.kpi', generatedAt: 'T1', rating: 'accurate' });

    expect(res.status).toBe(404);
    expect(res.body.outcome).toBe('insight_not_found');
  });

  it('a malformed request body (missing rating) is a 400 ValidationError', async () => {
    silenceLogs();
    const res = await request(createApp())
      .post('/api/insights/feedback')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1' });

    expect(res.status).toBe(400);
    expect(res.body.errorClass).toBe('ValidationError');
  });

  it('carries a correlation id in the header matching the body', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });

    const res = await request(createApp())
      .post('/api/insights/feedback')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });

  it('resubmitting is idempotent: updated, not a second entry', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });
    const app = createApp();

    await request(app)
      .post('/api/insights/feedback')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    const second = await request(app)
      .post('/api/insights/feedback')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'inaccurate' });

    expect(second.body.outcome).toBe('updated');
  });
});

describe('GET /api/insights/feedback-status', () => {
  beforeEach(() => {
    clearLatest();
    clearFeedback();
  });

  it('lists the KPI as needing feedback before any is given (acceptance #2)', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });

    const res = await request(createApp()).get('/api/insights/feedback-status?generatedAt=T1');

    expect(res.status).toBe(200);
    expect(res.body.kpiKeysNeedingFeedback).toEqual(['business.revenue.total']);
    expect(res.body.kpiKeysWithFeedback).toEqual([]);
  });

  it('moves the KPI to kpiKeysWithFeedback once feedback is submitted', async () => {
    silenceLogs();
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });
    const app = createApp();

    await request(app)
      .post('/api/insights/feedback')
      .send({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    const res = await request(app).get('/api/insights/feedback-status?generatedAt=T1');

    expect(res.body.kpiKeysWithFeedback).toEqual(['business.revenue.total']);
    expect(res.body.kpiKeysNeedingFeedback).toEqual([]);
  });
});
