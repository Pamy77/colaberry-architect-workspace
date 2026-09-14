/**
 * Stand-in for a QuickBooks Transaction/Invoice API response (STORY-005
 * dry-run adapter; see `../financialSyncSources.ts`).
 *
 * A TypeScript module for the same reason as `googleSheetsSample.ts` — it
 * needs to survive a `tsc` build, not just `ts-jest`.
 */

export interface QuickbooksRawRow {
  Id: string;
  TxnDate: string;
  TotalAmt?: number;
}

// qb-104's missing TotalAmt is intentional: it still has a non-empty date,
// so it passes the minimal integrity check (non-empty id + one non-empty
// field) even though it's an incomplete record — a deliberate edge case,
// not every field being required.
export const quickbooksSampleRows: QuickbooksRawRow[] = [
  { Id: 'qb-101', TxnDate: '2026-08-02', TotalAmt: 3200.5 },
  { Id: 'qb-102', TxnDate: '2026-08-09', TotalAmt: 1450.75 },
  { Id: 'qb-103', TxnDate: '2026-08-16', TotalAmt: 2875.0 },
  { Id: 'qb-104', TxnDate: '2026-08-23' },
];
