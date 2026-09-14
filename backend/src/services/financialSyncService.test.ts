import { runFinancialSync, createDefaultSources } from './financialSyncService';
import { clearRecords, getRecord, listRecords } from './financialRecordStore';
import type { SyncSource } from './financialSyncSources';
import type { SyncRecord } from './financialRecordStore';

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

function fakeSource(name: 'google_sheets' | 'quickbooks', records: SyncRecord[]): SyncSource {
  return { name, fetch: async () => records };
}

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    source: 'google_sheets',
    externalId: 'x1',
    fields: { amount: '10' },
    fetchedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  clearRecords();
});

describe('runFinancialSync — happy path', () => {
  it('both sources ok: every record stored, overall status ok', async () => {
    const gs = fakeSource('google_sheets', [record({ externalId: 'gs-1' })]);
    const qb = fakeSource('quickbooks', [record({ source: 'quickbooks', externalId: 'qb-1' })]);

    const result = await runFinancialSync([gs, qb]);

    expect(result.status).toBe('ok');
    expect(result.sources).toEqual([
      { source: 'google_sheets', outcome: 'ok', recordsFetched: 1, recordsStored: 1, recordsRejected: 0 },
      { source: 'quickbooks', outcome: 'ok', recordsFetched: 1, recordsStored: 1, recordsRejected: 0 },
    ]);
    expect(getRecord('google_sheets', 'gs-1')).toBeDefined();
    expect(getRecord('quickbooks', 'qb-1')).toBeDefined();
  });

  it('a source with zero records is ok, not an error', async () => {
    const gs = fakeSource('google_sheets', []);
    const qb = fakeSource('quickbooks', [record({ source: 'quickbooks', externalId: 'qb-1' })]);

    const result = await runFinancialSync([gs, qb]);

    expect(result.status).toBe('ok');
    const gsResult = result.sources.find((s) => s.source === 'google_sheets');
    expect(gsResult).toMatchObject({ outcome: 'ok', recordsFetched: 0, recordsStored: 0 });
  });
});

describe('runFinancialSync — data integrity', () => {
  it('a record missing externalId is rejected, not stored, and the source is partial when some records still pass', async () => {
    const gs = fakeSource('google_sheets', [
      record({ externalId: 'gs-1' }),
      record({ externalId: '' }), // fails integrity: no externalId
    ]);
    const qb = fakeSource('quickbooks', [record({ source: 'quickbooks', externalId: 'qb-1' })]);

    const result = await runFinancialSync([gs, qb]);

    const gsResult = result.sources.find((s) => s.source === 'google_sheets');
    expect(gsResult).toMatchObject({
      outcome: 'partial',
      recordsFetched: 2,
      recordsStored: 1,
      recordsRejected: 1,
    });
    expect(listRecords('google_sheets')).toHaveLength(1); // the rejected row never reached the store
    expect(result.status).toBe('partial'); // one source ok (quickbooks), one source partial
  });

  it('a source where every record fails integrity is a source-level failure, not a silent ok', async () => {
    const gs = fakeSource('google_sheets', [record({ externalId: '' }), record({ externalId: '', fields: {} })]);
    const qb = fakeSource('quickbooks', [record({ source: 'quickbooks', externalId: 'qb-1' })]);

    const result = await runFinancialSync([gs, qb]);

    const gsResult = result.sources.find((s) => s.source === 'google_sheets');
    expect(gsResult).toMatchObject({
      outcome: 'failed',
      reason: 'data_integrity',
      recordsFetched: 2,
      recordsStored: 0,
      recordsRejected: 2,
    });
    expect(result.status).toBe('partial'); // quickbooks still ok, so not a total failure
  });

  it('a record with a non-empty field but no externalId is rejected even if the field itself looks valid', async () => {
    const gs = fakeSource('google_sheets', [record({ externalId: '', fields: { revenue: '5000' } })]);
    const result = await runFinancialSync([gs]);
    expect(result.sources[0]).toMatchObject({ recordsStored: 0, recordsRejected: 1 });
  });
});

describe('runFinancialSync — retry and failure', () => {
  it('a source that fails then recovers within its retry budget still succeeds', async () => {
    let attempts = 0;
    const flaky: SyncSource = {
      name: 'google_sheets',
      async fetch() {
        attempts += 1;
        if (attempts < 2) throw new Error('temporary network blip');
        return [record({ externalId: 'gs-1' })];
      },
    };
    const qb = fakeSource('quickbooks', [record({ source: 'quickbooks', externalId: 'qb-1' })]);

    const result = await runFinancialSync([flaky, qb], { retries: 2, sleep: noSleep });

    expect(attempts).toBe(2);
    expect(result.status).toBe('ok');
    expect(result.sources.find((s) => s.source === 'google_sheets')).toMatchObject({ outcome: 'ok', recordsStored: 1 });
  });

  it('a source that exhausts its retries is failed for that source only — the other source still stores its data', async () => {
    const dead: SyncSource = {
      name: 'google_sheets',
      async fetch() {
        throw new Error('auth failure');
      },
    };
    const qb = fakeSource('quickbooks', [record({ source: 'quickbooks', externalId: 'qb-1' })]);

    const result = await runFinancialSync([dead, qb], { retries: 1, sleep: noSleep });

    expect(result.sources.find((s) => s.source === 'google_sheets')).toMatchObject({
      outcome: 'failed',
      reason: 'fetch_failed',
      error: 'auth failure',
    });
    expect(result.status).toBe('partial'); // quickbooks succeeded, so not a total loss
    expect(getRecord('quickbooks', 'qb-1')).toBeDefined(); // no data loss on the source that did work
  });

  it('every source failing is an overall failed run, with nothing stored', async () => {
    const dead: SyncSource = {
      name: 'google_sheets',
      async fetch() {
        throw new Error('network timeout');
      },
    };
    const alsoDead: SyncSource = {
      name: 'quickbooks',
      async fetch() {
        throw new Error('network timeout');
      },
    };

    const result = await runFinancialSync([dead, alsoDead], { retries: 0, sleep: noSleep });

    expect(result.status).toBe('failed');
    expect(listRecords()).toEqual([]);
  });
});

describe('runFinancialSync — idempotency', () => {
  it('running the same sync twice does not duplicate records, only updates them in place', async () => {
    const first = fakeSource('google_sheets', [record({ externalId: 'gs-1', fields: { amount: '10' } })]);
    await runFinancialSync([first]);

    const second = fakeSource('google_sheets', [record({ externalId: 'gs-1', fields: { amount: '20' } })]);
    await runFinancialSync([second]);

    expect(listRecords('google_sheets')).toHaveLength(1);
    expect(getRecord('google_sheets', 'gs-1')?.fields.amount).toBe('20');
  });
});

describe('runFinancialSync — audit logging (Trust acceptance criterion)', () => {
  it('logs one sync_run line per call, with a timestamp, status, and correlation id', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const gs = fakeSource('google_sheets', [record({ externalId: 'gs-1' })]);

    const result = await runFinancialSync([gs]);

    const runLine = auditLines(logSpy).find((l) => l.event === 'sync_run');
    expect(runLine).toBeDefined();
    expect(runLine).toMatchObject({ outcome: 'ok', correlation_id: result.correlationId });
    expect(typeof runLine?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('also logs a per-source processing_step line for each fetch attempt', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const gs = fakeSource('google_sheets', [record({ externalId: 'gs-1' })]);

    await runFinancialSync([gs]);

    const stepLine = auditLines(logSpy).find((l) => l.event === 'processing_step' && l.status === 'succeeded');
    expect(stepLine).toBeDefined();
    expect(stepLine?.step).toBe('fetch_google_sheets');
    logSpy.mockRestore();
  });
});

describe('runFinancialSync — real default sources (integration-style, no credentials)', () => {
  it('wires the real dry-run adapters end to end against their fixtures', async () => {
    const result = await runFinancialSync(createDefaultSources());

    // Real fixtures: Google Sheets has 1 row with a blank rowId (rejected);
    // QuickBooks' incomplete row still has a non-empty date field, so it
    // passes the minimal integrity check.
    expect(result.sources.find((s) => s.source === 'google_sheets')).toMatchObject({
      outcome: 'partial',
      recordsFetched: 4,
      recordsStored: 3,
      recordsRejected: 1,
    });
    expect(result.sources.find((s) => s.source === 'quickbooks')).toMatchObject({
      outcome: 'ok',
      recordsFetched: 4,
      recordsStored: 4,
      recordsRejected: 0,
    });
    expect(result.status).toBe('partial');
    expect(getRecord('quickbooks', 'qb-101')?.fields).toEqual({ date: '2026-08-02', amount: '3200.5' });
  });
});
