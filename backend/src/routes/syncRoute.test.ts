import request from 'supertest';
import { createApp } from '../app';
import { clearRecords, getRecord } from '../services/financialRecordStore';

function silenceLogs(): jest.SpyInstance {
  return jest.spyOn(console, 'log').mockImplementation(() => undefined);
}

describe('POST /api/sync/run', () => {
  beforeEach(() => {
    clearRecords();
  });

  it('syncs the real dry-run sources and returns a contract-valid partial result (one fixture row is intentionally incomplete)', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/sync/run');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('partial');
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.sources.find((s: { source: string }) => s.source === 'google_sheets')).toMatchObject({
      outcome: 'partial',
      recordsStored: 3,
      recordsRejected: 1,
    });
    expect(res.body.sources.find((s: { source: string }) => s.source === 'quickbooks')).toMatchObject({
      outcome: 'ok',
      recordsStored: 4,
    });
  });

  it('carries a correlation id in both the header and the body, and they match', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/sync/run');

    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });

  it('actually stores the synced records — a caller can read back what synchronization initiated (acceptance #1)', async () => {
    silenceLogs();
    await request(createApp()).post('/api/sync/run');

    expect(getRecord('quickbooks', 'qb-101')?.fields).toEqual({ date: '2026-08-02', amount: '3200.5' });
    expect(getRecord('google_sheets', 'gs-1')?.fields).toEqual({
      date: '2026-08-01',
      revenue: '5230.00',
      category: 'sales',
    });
  });

  it('running it twice does not duplicate records (idempotent re-run)', async () => {
    silenceLogs();
    await request(createApp()).post('/api/sync/run');
    const second = await request(createApp()).post('/api/sync/run');

    expect(second.status).toBe(200);
    // Same fixtures both times -> same 3 stored google_sheets records, not 6.
    expect(second.body.sources.find((s: { source: string }) => s.source === 'google_sheets').recordsStored).toBe(3);
  });
});
