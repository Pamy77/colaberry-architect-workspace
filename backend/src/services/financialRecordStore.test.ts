import {
  clearRecords,
  getRecord,
  listRecords,
  upsertRecord,
  type SyncRecord,
} from './financialRecordStore';

function record(overrides: Partial<SyncRecord> = {}): SyncRecord {
  return {
    source: 'google_sheets',
    externalId: 'row-1',
    fields: { amount: '100.00' },
    fetchedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  clearRecords();
});

describe('upsertRecord', () => {
  it('stores a new record and reports created: true', () => {
    const { record: stored, created } = upsertRecord(record());
    expect(created).toBe(true);
    expect(stored).toEqual(record());
  });

  it('upserting the same (source, externalId) again updates the value and reports created: false', () => {
    upsertRecord(record({ fields: { amount: '100.00' } }));
    const updated = upsertRecord(
      record({ fields: { amount: '150.00' }, fetchedAt: '2026-09-14T01:00:00.000Z' }),
    );

    expect(updated.created).toBe(false);
    expect(getRecord('google_sheets', 'row-1')?.fields.amount).toBe('150.00');
    expect(getRecord('google_sheets', 'row-1')?.fetchedAt).toBe('2026-09-14T01:00:00.000Z');
    expect(listRecords()).toHaveLength(1); // no duplicate — same key, one row
  });

  it('treats the same externalId in different sources as two independent records', () => {
    upsertRecord(record({ source: 'google_sheets', externalId: 'row-1', fields: { amount: '10' } }));
    upsertRecord(record({ source: 'quickbooks', externalId: 'row-1', fields: { amount: '20' } }));

    expect(getRecord('google_sheets', 'row-1')?.fields.amount).toBe('10');
    expect(getRecord('quickbooks', 'row-1')?.fields.amount).toBe('20');
    expect(listRecords()).toHaveLength(2);
  });

  it('different externalIds within the same source are independent records', () => {
    upsertRecord(record({ externalId: 'row-1' }));
    upsertRecord(record({ externalId: 'row-2' }));
    expect(listRecords('google_sheets')).toHaveLength(2);
  });
});

describe('getRecord', () => {
  it('returns undefined for a record that was never synced', () => {
    expect(getRecord('quickbooks', 'does-not-exist')).toBeUndefined();
  });
});

describe('listRecords', () => {
  it('returns an empty list when nothing has been synced', () => {
    expect(listRecords()).toEqual([]);
  });

  it('filters to one source when given', () => {
    upsertRecord(record({ source: 'google_sheets', externalId: 'a' }));
    upsertRecord(record({ source: 'quickbooks', externalId: 'b' }));

    expect(listRecords('google_sheets')).toHaveLength(1);
    expect(listRecords('quickbooks')).toHaveLength(1);
    expect(listRecords()).toHaveLength(2);
  });

  it('sorts deterministically by source then externalId', () => {
    upsertRecord(record({ source: 'quickbooks', externalId: 'z' }));
    upsertRecord(record({ source: 'google_sheets', externalId: 'b' }));
    upsertRecord(record({ source: 'google_sheets', externalId: 'a' }));

    expect(listRecords().map((r) => `${r.source}:${r.externalId}`)).toEqual([
      'google_sheets:a',
      'google_sheets:b',
      'quickbooks:z',
    ]);
  });
});

describe('clearRecords', () => {
  it('resets the store to empty', () => {
    upsertRecord(record());
    clearRecords();
    expect(listRecords()).toEqual([]);
  });
});
