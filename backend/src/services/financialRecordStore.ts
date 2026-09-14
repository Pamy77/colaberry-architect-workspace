/**
 * Holds financial records synced from Google Sheets and QuickBooks
 * (REQ-006 / REQ-015, STORY-005; see `directives/06-financial-sync.md`).
 *
 * Walking-skeleton shortcut, same in-process pattern as `latestKpiStore.ts` /
 * `pendingAlertStore.ts`: a single Map, not a database. Lost on restart —
 * durable storage is a later story.
 *
 * Idempotent by construction: records are keyed by `(source, externalId)`, so
 * syncing the same record twice upserts in place instead of creating a
 * duplicate — the key IS the dedup mechanism, there is no separate
 * "already exists?" side-table to keep in sync.
 */

export type SyncSourceName = 'google_sheets' | 'quickbooks';

export interface SyncRecord {
  source: SyncSourceName;
  /** The source's own row/transaction id. Unique within that source only. */
  externalId: string;
  fields: Record<string, string>;
  /** ISO-8601 timestamp of the fetch that produced this value. */
  fetchedAt: string;
}

function recordKey(source: SyncSourceName, externalId: string): string {
  return `${source}::${externalId}`;
}

const records = new Map<string, SyncRecord>();

/**
 * Stores `record` under its `(source, externalId)` key, replacing whatever
 * was there before. Returns `created: true` only the first time a given key
 * is stored, so a caller can report "new vs. updated" without a separate
 * lookup — later syncs of the same record report `created: false` even
 * though the stored `fields` do change to the newer fetch.
 */
export function upsertRecord(record: SyncRecord): { record: SyncRecord; created: boolean } {
  const key = recordKey(record.source, record.externalId);
  const created = !records.has(key);
  records.set(key, record);
  return { record, created };
}

export function getRecord(source: SyncSourceName, externalId: string): SyncRecord | undefined {
  return records.get(recordKey(source, externalId));
}

/** All stored records, optionally filtered to one source, sorted deterministically. */
export function listRecords(source?: SyncSourceName): SyncRecord[] {
  const all = Array.from(records.values()).filter((r) => !source || r.source === source);
  return all.sort((a, b) => a.source.localeCompare(b.source) || a.externalId.localeCompare(b.externalId));
}

/** Test seam: reset the in-process record store between cases. */
export function clearRecords(): void {
  records.clear();
}
