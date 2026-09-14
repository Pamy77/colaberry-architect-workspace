import { z } from 'zod';
import type { SourceSyncResult, SyncRunResult } from '../services/financialSyncService';

/**
 * Response contract for POST /api/sync/run (STORY-005 / REQ-006 / REQ-015).
 *
 * `status` / per-source `outcome`: `ok` (every record synced), `partial`
 * (some records or some sources didn't make it in, but at least one source
 * synced something), `failed` (nothing synced). See
 * `directives/06-financial-sync.md` for exactly how each is derived.
 */

export const SourceSyncResultSchema = z.object({
  source: z.enum(['google_sheets', 'quickbooks']),
  outcome: z.enum(['ok', 'partial', 'failed']),
  recordsFetched: z.number().int().nonnegative(),
  recordsStored: z.number().int().nonnegative(),
  recordsRejected: z.number().int().nonnegative(),
  reason: z.enum(['fetch_failed', 'data_integrity']).optional(),
  error: z.string().optional(),
});

export const SyncRunResponseSchema = z.object({
  status: z.enum(['ok', 'partial', 'failed']),
  generatedAt: z.string(),
  correlationId: z.string(),
  sources: z.array(SourceSyncResultSchema),
});
export type SyncRunResponse = z.infer<typeof SyncRunResponseSchema>;

// Compile-time guards: the runtime contract and the service types must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _sourceInSync: AssertAssignable<SourceSyncResult, z.infer<typeof SourceSyncResultSchema>> = true;
const _runInSync: AssertAssignable<SyncRunResult, SyncRunResponse> = true;
void _sourceInSync;
void _runInSync;
