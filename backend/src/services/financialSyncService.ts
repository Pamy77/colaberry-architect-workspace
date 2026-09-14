import { newRun, runStep, type ProcessingRun } from './processingAudit';
import { upsertRecord, type SyncRecord, type SyncSourceName } from './financialRecordStore';
import { createGoogleSheetsSource, createQuickbooksSource, type SyncSource } from './financialSyncSources';

/**
 * Orchestrates a financial-data sync across every configured source
 * (REQ-006 / REQ-015, STORY-005; see `directives/06-financial-sync.md`).
 *
 * For each source: fetch (via `processingAudit.runStep`, so every attempt
 * gets an explicit timeout, capped retries, and a timestamped audit line —
 * the Trust acceptance criterion), run each fetched record through the
 * data-integrity check, and upsert the survivors into
 * `financialRecordStore`. One source's failure never blocks or rolls back
 * another source's successfully-stored data.
 */

export type SourceOutcome = 'ok' | 'partial' | 'failed';
export type SyncRunStatus = 'ok' | 'partial' | 'failed';
export type SourceFailureReason = 'fetch_failed' | 'data_integrity';

export interface SourceSyncResult {
  source: SyncSourceName;
  outcome: SourceOutcome;
  recordsFetched: number;
  recordsStored: number;
  recordsRejected: number;
  reason?: SourceFailureReason;
  error?: string;
}

export interface SyncRunResult {
  status: SyncRunStatus;
  generatedAt: string;
  correlationId: string;
  sources: SourceSyncResult[];
}

export interface SyncOptions {
  timeoutMs?: number;
  retries?: number;
  /** Injectable delay for tests, forwarded to `runStep`. */
  sleep?: (ms: number) => Promise<void>;
}

const SYNC_TIMEOUT_MS = readIntEnv('SYNC_TIMEOUT_MS', 10_000);
const SYNC_RETRIES = readIntEnv('SYNC_RETRIES', 2);

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A record is "accurately reflected" only once it has an id and something to show for it. */
function passesIntegrityCheck(record: SyncRecord): boolean {
  if (record.externalId === '') return false;
  return Object.values(record.fields).some((value) => value !== '');
}

/** The default, real (dry-run) sources — Google Sheets and QuickBooks. */
export function createDefaultSources(): SyncSource[] {
  return [createGoogleSheetsSource(), createQuickbooksSource()];
}

async function syncOneSource(
  run: ProcessingRun,
  source: SyncSource,
  options: SyncOptions,
): Promise<SourceSyncResult> {
  let records: SyncRecord[];
  try {
    records = await runStep(run, `fetch_${source.name}`, () => source.fetch(), {
      timeoutMs: options.timeoutMs ?? SYNC_TIMEOUT_MS,
      retries: options.retries ?? SYNC_RETRIES,
      sleep: options.sleep,
      context: { source: source.name },
    });
  } catch (err) {
    return {
      source: source.name,
      outcome: 'failed',
      recordsFetched: 0,
      recordsStored: 0,
      recordsRejected: 0,
      reason: 'fetch_failed',
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }

  let stored = 0;
  let rejected = 0;
  for (const record of records) {
    if (passesIntegrityCheck(record)) {
      upsertRecord(record);
      stored += 1;
    } else {
      rejected += 1;
    }
  }

  // Zero records fetched is a legitimate empty sync, not a failure. Every
  // record rejected (when at least one was fetched) is a source-level data
  // integrity failure, not a silent empty success. Anything in between is
  // reported as partial rather than rounded up to ok, so a caller can see
  // that some of this source's data didn't make it in.
  const outcome: SourceOutcome =
    records.length === 0 || rejected === 0
      ? 'ok'
      : stored === 0
        ? 'failed'
        : 'partial';

  return {
    source: source.name,
    outcome,
    recordsFetched: records.length,
    recordsStored: stored,
    recordsRejected: rejected,
    reason: outcome === 'failed' && records.length > 0 ? 'data_integrity' : undefined,
  };
}

/**
 * Overall run status: `ok` only if every source is `ok`; `failed` only if no
 * source reached `ok`; `partial` otherwise. A source's own `partial` or
 * `failed` outcome is fully visible in `sources[]` regardless of how it
 * rolls up here.
 */
function overallStatus(sources: SourceSyncResult[]): SyncRunStatus {
  if (sources.every((s) => s.outcome === 'ok')) return 'ok';
  if (sources.some((s) => s.outcome === 'ok')) return 'partial';
  return 'failed';
}

function logSyncRun(result: SyncRunResult): void {
  console.log(
    JSON.stringify({
      timestamp: result.generatedAt,
      level: result.status === 'failed' ? 'error' : result.status === 'partial' ? 'warn' : 'info',
      service: 'backend',
      event: 'sync_run',
      correlation_id: result.correlationId,
      outcome: result.status,
      sources: result.sources.map((s) => ({
        source: s.source,
        outcome: s.outcome,
        recordsFetched: s.recordsFetched,
        recordsStored: s.recordsStored,
        recordsRejected: s.recordsRejected,
      })),
    }),
  );
}

/**
 * Runs a sync across `sources` (defaults to every configured source) and
 * returns the per-source + overall result. Sources are synced one at a time
 * — simplest and sufficient for two walking-skeleton sources; nothing about
 * the contract requires them to run concurrently.
 */
export async function runFinancialSync(
  sources: SyncSource[] = createDefaultSources(),
  options: SyncOptions = {},
): Promise<SyncRunResult> {
  const run = newRun();
  const results: SourceSyncResult[] = [];
  for (const source of sources) {
    results.push(await syncOneSource(run, source, options));
  }

  const result: SyncRunResult = {
    status: overallStatus(results),
    generatedAt: new Date().toISOString(),
    correlationId: run.runId,
    sources: results,
  };
  logSyncRun(result);
  return result;
}
