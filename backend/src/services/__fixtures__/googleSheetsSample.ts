/**
 * Stand-in for a flattened Google Sheets API v4 `values.get` response
 * (STORY-005 dry-run adapter; see `../financialSyncSources.ts`).
 *
 * A TypeScript module rather than a `.json` file so it compiles into
 * `dist/` along with everything else — plain JSON assets are not copied by
 * `tsc`, which broke this fixture in the built server the first time this
 * was tried; fixed by making the fixture code, not a separate asset.
 */

export interface GoogleSheetsRawRow {
  rowId: string;
  date: string;
  revenue: string;
  category: string;
}

// The blank rowId on the last row is intentional: it exercises the
// data-integrity rejection path (see financialSyncService.ts).
export const googleSheetsSampleRows: GoogleSheetsRawRow[] = [
  { rowId: 'gs-1', date: '2026-08-01', revenue: '5230.00', category: 'sales' },
  { rowId: 'gs-2', date: '2026-08-08', revenue: '4800.00', category: 'sales' },
  { rowId: 'gs-3', date: '2026-08-15', revenue: '7450.00', category: 'sales' },
  { rowId: '', date: '2026-08-22', revenue: '1200.00', category: 'sales' },
];
