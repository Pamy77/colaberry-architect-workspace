import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { sendValidated } from '../lib/sendValidated';
import { cleanFile, ParseError } from '../services/dataCleaningService';
import { calculateKpis, logKpiCalculation } from '../services/kpiService';
import {
  checkIdempotency,
  deriveIdempotencyKey,
  newRun,
  RecentRuns,
  rememberRun,
  runStep,
  terminalWhenNamed,
} from '../services/processingAudit';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_ROWS,
  UploadErrorResponse,
  UploadErrorResponseSchema,
  UploadSuccessResponse,
  UploadSuccessResponseSchema,
} from './uploadContract';

class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  const extension = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(extension as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number])) {
    cb(
      new UploadValidationError(
        `Unsupported file type "${extension || 'unknown'}". Allowed types: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`,
      ),
    );
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
  fileFilter,
});

// Bounded, in-process registry of recently completed processing runs, keyed on
// upload content. Lets a re-submitted identical upload (double-click, client
// retry) be answered from the previous run instead of parsed/cleaned/calculated
// a second time. Size is env-configurable; see RecentRuns for the per-process /
// restart-clears-it caveat (durable dedupe is a later persistence story).
const DEDUP_CACHE_SIZE = process.env.PROCESSING_DEDUP_CACHE_SIZE
  ? Number(process.env.PROCESSING_DEDUP_CACHE_SIZE)
  : 256;

// Exported so the test suite can clear it between cases; not part of the route contract.
export const recentRuns = new RecentRuns<UploadSuccessResponse>(DEDUP_CACHE_SIZE);

// cleanFile throws ParseError for deterministically-bad input (corrupt file, no
// rows) — retrying that would just fail again, so it is terminal. Any other
// throw from the clean step is treated as transient and retried by runStep.
const cleaningIsRetryable = terminalWhenNamed('ParseError');

function logUploadError(context: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'backend',
      event: 'file_upload',
      outcome: 'failure',
      context,
    }),
  );
}

export const uploadRouter = Router();

uploadRouter.post('/upload', (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, async (err: unknown) => {
    if (err) {
      next(err);
      return;
    }

    if (!req.file) {
      next(new UploadValidationError('No file uploaded. Attach a file under the "file" field.'));
      return;
    }

    const file = req.file;
    const run = newRun();
    res.setHeader('X-Correlation-ID', run.runId);
    const auditContext = { filename: file.originalname, sizeBytes: file.size };

    // Step: record that the upload arrived. Nothing to retry — receiving already
    // happened — but it belongs in the correlation-linked audit trail.
    await runStep(run, 'receive_upload', () => ({ mimeType: file.mimetype }), {
      retries: 0,
      context: auditContext,
    });

    // Step: has this exact upload already been fully processed? If so, answer
    // from the previous run instead of doing the work again.
    const idempotencyKey = deriveIdempotencyKey(file.buffer, file.originalname);
    const decision = checkIdempotency(run, recentRuns, idempotencyKey);
    if (decision.duplicate && decision.priorResult) {
      sendValidated(res, UploadSuccessResponseSchema, 200, decision.priorResult);
      return;
    }

    // Step: parse + clean. ParseError -> 400 (terminal); any other error is
    // retried with backoff by runStep before it surfaces.
    let cleaning;
    try {
      cleaning = await runStep(
        run,
        'clean_data',
        () => cleanFile(file.buffer, file.originalname, UPLOAD_MAX_ROWS),
        { isRetryable: cleaningIsRetryable, context: auditContext },
      );
    } catch (cleaningErr) {
      if (cleaningErr instanceof ParseError) {
        next(new UploadValidationError(cleaningErr.message));
        return;
      }
      next(cleaningErr);
      return;
    }

    // Step: calculate KPIs. calculateKpis is total for data-shaped problems (it
    // returns clarificationsNeeded rather than throwing), so a throw here is an
    // unexpected bug, not a transient fault — surface it immediately (retries: 0)
    // via the generic 500 path, with the gave_up audit line already written.
    let kpiResult;
    try {
      kpiResult = await runStep(run, 'calculate_kpis', () => calculateKpis(cleaning), {
        retries: 0,
        context: auditContext,
      });
    } catch (kpiErr) {
      next(kpiErr);
      return;
    }
    logKpiCalculation(kpiResult, auditContext);

    const payload: UploadSuccessResponse = {
      status: 'accepted',
      filename: file.originalname,
      sizeBytes: file.size,
      mimeType: file.mimetype,
      cleaning: {
        headers: cleaning.headers,
        totalDataRows: cleaning.totalDataRows,
        cleanedRowCount: cleaning.cleanedRows.length,
        flaggedRowCount: cleaning.flaggedRows.length,
        flaggedRows: cleaning.flaggedRows.map((r) => ({ rowNumber: r.rowNumber, reason: r.reason })),
      },
      kpis: kpiResult,
    };

    // Remember only successful runs: a byte-identical re-submit is then served
    // from cache, while a corrected re-upload (different bytes -> different key)
    // still reprocesses normally.
    rememberRun(recentRuns, idempotencyKey, run, payload);

    sendValidated(res, UploadSuccessResponseSchema, 200, payload);
  });
});

// Express only recognizes this as error-handling middleware if it declares all 4 params.
export function uploadErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const isValidationError = err instanceof UploadValidationError || err instanceof multer.MulterError;
  const message = isValidationError
    ? (err as Error).message
    : 'Unexpected error while processing the upload.';

  const payload: UploadErrorResponse = {
    status: 'error',
    errorClass: isValidationError ? 'ValidationError' : 'UnknownError',
    message,
  };

  logUploadError({ errorClass: payload.errorClass, message: payload.message });

  sendValidated(res, UploadErrorResponseSchema, isValidationError ? 400 : 500, payload);
}
