import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { runFinancialSync } from '../services/financialSyncService';
import { SyncRunResponseSchema } from './syncContract';

/**
 * POST /api/sync/run — sync financial data from every configured source
 * (Google Sheets, QuickBooks) into the system (STORY-005 / REQ-006 /
 * REQ-015). Deterministic and idempotent: re-running upserts each record in
 * place rather than duplicating it. Meant to be called by hand, by a
 * scheduler, or (future) after subscription setup.
 *
 * `X-Correlation-ID` carries `runFinancialSync`'s own run id — the same id
 * that tags every `processing_step` / `sync_run` audit line for this call —
 * so a caller can trace the response back to its exact log lines with one
 * id, not two.
 */

export const syncRouter = Router();

syncRouter.post('/sync/run', async (_req: Request, res: Response) => {
  const result = await runFinancialSync();
  res.setHeader('X-Correlation-ID', result.correlationId);

  const status = result.status === 'failed' ? 502 : 200;
  sendValidated(res, SyncRunResponseSchema, status, result);
});
