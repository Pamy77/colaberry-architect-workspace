import request from 'supertest';
import { createApp } from '../app';
import { clearLatest, setLatest } from '../services/latestKpiStore';
import { clearRecords, upsertRecord } from '../services/financialRecordStore';
import { clearDecisions, recordDecision } from '../services/decisionLog';
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
        evidenceNote: '5 of 5 row(s) had a numeric value (100% coverage).',
        basis: { column: 'revenue', rowsConsidered: 5, rowsUsed: 5, coverage: 1 },
      },
    ],
    clarificationsNeeded: [],
    summary: { totalDataRows: 5, cleanedRowCount: 5, flaggedRowCount: 0, numericColumns: ['revenue'], dateRange: null, monthlySeries: [] },
  };
}

function seedAllThreeSources(): void {
  setLatest({ result: calc(), filename: 'sales.csv', generatedAt: '2026-09-19T00:00:00.000Z' });
  upsertRecord({
    source: 'quickbooks',
    externalId: 'qb-1',
    fields: { date: '2026-09-01', amount: '100' },
    fetchedAt: '2026-09-19T00:00:00.000Z',
  });
  recordDecision({ type: 'subscription_change', summary: 'Subscribed to $9/month', context: { planId: 'plan_9' } });
}

describe('GET /api/reports/detailed', () => {
  beforeEach(() => {
    clearLatest();
    clearRecords();
    clearDecisions();
  });

  it('returns ok with every section when all three sources are present', async () => {
    silenceLogs();
    seedAllThreeSources();

    const res = await request(createApp()).get('/api/reports/detailed');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.kpis).not.toBeNull();
    expect(res.body.financial.recordCount).toBe(1);
    expect(res.body.decisions.decisionCount).toBe(1);
  });

  it('returns incomplete and names the missing sources when data is absent (acceptance #2)', async () => {
    silenceLogs();
    const res = await request(createApp()).get('/api/reports/detailed');

    expect(res.status).toBe(200); // notification, not an error
    expect(res.body.status).toBe('incomplete');
    expect(res.body.missingDataSources).toEqual(['kpis', 'financial', 'decisions']);
  });

  it('the sources query param narrows which sections are populated', async () => {
    silenceLogs();
    seedAllThreeSources();

    const res = await request(createApp()).get('/api/reports/detailed?sources=kpis');

    expect(res.body.sourcesRequested).toEqual(['kpis']);
    expect(res.body.kpis).not.toBeNull();
    expect(res.body.financial).toBeNull();
    expect(res.body.decisions).toBeNull();
  });

  it('an unrecognized templateId is a 400, report template error', async () => {
    silenceLogs();
    const res = await request(createApp()).get('/api/reports/detailed?templateId=quarterly_pdf');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('invalid_template');
  });

  it('carries a correlation id in the header matching the body', async () => {
    silenceLogs();
    const res = await request(createApp()).get('/api/reports/detailed');

    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });
});
