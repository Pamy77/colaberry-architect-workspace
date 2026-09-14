import { createGoogleSheetsSource, createQuickbooksSource } from './financialSyncSources';

describe('createGoogleSheetsSource', () => {
  it('maps the fixture rows into SyncRecords with a shared fetchedAt', async () => {
    const records = await createGoogleSheetsSource().fetch();

    expect(records).toHaveLength(4);
    expect(records.every((r) => r.source === 'google_sheets')).toBe(true);
    expect(records.every((r) => r.fetchedAt === records[0].fetchedAt)).toBe(true);

    const gs1 = records.find((r) => r.externalId === 'gs-1');
    expect(gs1?.fields).toEqual({ date: '2026-08-01', revenue: '5230.00', category: 'sales' });
  });

  it('maps a row missing rowId through with externalId "" rather than throwing', async () => {
    const records = await createGoogleSheetsSource().fetch();
    const blank = records.find((r) => r.fields.revenue === '1200.00');
    expect(blank?.externalId).toBe('');
  });
});

describe('createQuickbooksSource', () => {
  it('maps the fixture rows into SyncRecords using QuickBooks field names', async () => {
    const records = await createQuickbooksSource().fetch();

    expect(records).toHaveLength(4);
    expect(records.every((r) => r.source === 'quickbooks')).toBe(true);

    const qb101 = records.find((r) => r.externalId === 'qb-101');
    expect(qb101?.fields).toEqual({ date: '2026-08-02', amount: '3200.5' });
  });

  it('maps a row missing TotalAmt through with amount "" rather than throwing', async () => {
    const records = await createQuickbooksSource().fetch();
    const incomplete = records.find((r) => r.externalId === 'qb-104');
    expect(incomplete?.fields.amount).toBe('');
    expect(incomplete?.fields.date).toBe('2026-08-23'); // the rest of the row still maps
  });
});
