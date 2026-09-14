import type { SyncRecord, SyncSourceName } from './financialRecordStore';
import { googleSheetsSampleRows } from './__fixtures__/googleSheetsSample';
import { quickbooksSampleRows } from './__fixtures__/quickbooksSample';

/**
 * Adapters that fetch raw records from an external financial system and map
 * them into this project's `SyncRecord` shape (REQ-006 / REQ-015, STORY-005;
 * see `directives/06-financial-sync.md`).
 *
 * Walking-skeleton shortcut, same "dry-run until credentials exist" shape as
 * `emailTransport.ts` / `slackTransport.ts`: both adapters here map a fixture
 * standing in for the real API response — no OAuth client, no API key,
 * nothing real called. The fixture is a plain TypeScript module (not a
 * `.json` asset read off disk): a `tsc` build only compiles `.ts` files into
 * `dist/`, so a disk-read fixture works under `ts-jest` but 404s in the
 * built server — caught via a live check against the compiled server, not
 * just unit tests, and fixed by making the fixture code. Swapping in a live
 * client later means adding a new `SyncSource` implementation, not
 * rewriting the orchestration around it.
 */

export interface SyncSource {
  readonly name: SyncSourceName;
  fetch(): Promise<SyncRecord[]>;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Google Sheets adapter (dry-run). Raw rows look like
 * `{ rowId, date, revenue, category }` — a simplified stand-in for what the
 * Sheets API v4 `values.get` response looks like once flattened to objects.
 * A row missing `rowId` maps through with `externalId: ''` rather than
 * throwing — a malformed *row* is a data-integrity concern the orchestration
 * service rejects downstream, not something one bad row should abort the
 * whole fetch over.
 */
export function createGoogleSheetsSource(): SyncSource {
  return {
    name: 'google_sheets',
    async fetch(): Promise<SyncRecord[]> {
      const fetchedAt = new Date().toISOString();
      return googleSheetsSampleRows.map(
        (row): SyncRecord => ({
          source: 'google_sheets',
          externalId: asString(row.rowId),
          fields: {
            date: asString(row.date),
            revenue: asString(row.revenue),
            category: asString(row.category),
          },
          fetchedAt,
        }),
      );
    },
  };
}

/**
 * QuickBooks adapter (dry-run). Raw rows look like
 * `{ Id, TxnDate, TotalAmt }` — QuickBooks' own field naming, a simplified
 * stand-in for a Transaction/Invoice object. Same "map what's there, let the
 * integrity check reject what's missing" rule as the Sheets adapter.
 */
export function createQuickbooksSource(): SyncSource {
  return {
    name: 'quickbooks',
    async fetch(): Promise<SyncRecord[]> {
      const fetchedAt = new Date().toISOString();
      return quickbooksSampleRows.map(
        (row): SyncRecord => ({
          source: 'quickbooks',
          externalId: asString(row.Id),
          fields: {
            date: asString(row.TxnDate),
            amount: asString(row.TotalAmt),
          },
          fetchedAt,
        }),
      );
    },
  };
}
