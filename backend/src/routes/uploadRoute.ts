import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { sendValidated } from '../lib/sendValidated';
import { cleanFile, ParseError } from '../services/dataCleaningService';
import { calculateKpis, logKpiCalculation } from '../services/kpiService';
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

function logEvent(event: string, outcome: 'success' | 'failure', context: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'success' ? 'info' : 'warn',
      service: 'backend',
      event,
      outcome,
      context,
    }),
  );
}

function logUploadOutcome(outcome: 'success' | 'failure', context: Record<string, unknown>): void {
  logEvent('file_upload', outcome, context);
}

function logCleaningOutcome(outcome: 'success' | 'failure', context: Record<string, unknown>): void {
  logEvent('data_cleaning', outcome, context);
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

    logUploadOutcome('success', { filename: req.file.originalname, sizeBytes: req.file.size });

    let cleaning;
    try {
      cleaning = await cleanFile(req.file.buffer, req.file.originalname, UPLOAD_MAX_ROWS);
    } catch (cleaningErr) {
      if (cleaningErr instanceof ParseError) {
        logCleaningOutcome('failure', { filename: req.file.originalname, message: cleaningErr.message });
        next(new UploadValidationError(cleaningErr.message));
        return;
      }
      next(cleaningErr);
      return;
    }

    logCleaningOutcome('success', {
      filename: req.file.originalname,
      totalDataRows: cleaning.totalDataRows,
      cleanedRowCount: cleaning.cleanedRows.length,
      flaggedRowCount: cleaning.flaggedRows.length,
    });

    // KPI calculation runs on the cleaned data. calculateKpis is total for
    // data-shaped problems (it returns clarificationsNeeded rather than
    // throwing); a throw here would be an unexpected bug, so map it to the
    // generic 500 path and still leave an audit line.
    let kpiResult;
    try {
      kpiResult = calculateKpis(cleaning);
    } catch (kpiErr) {
      logEvent('kpi_calculation', 'failure', {
        filename: req.file.originalname,
        message: (kpiErr as Error).message,
      });
      next(kpiErr);
      return;
    }
    logKpiCalculation(kpiResult, { filename: req.file.originalname });

    const payload: UploadSuccessResponse = {
      status: 'accepted',
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      cleaning: {
        headers: cleaning.headers,
        totalDataRows: cleaning.totalDataRows,
        cleanedRowCount: cleaning.cleanedRows.length,
        flaggedRowCount: cleaning.flaggedRows.length,
        flaggedRows: cleaning.flaggedRows.map((r) => ({ rowNumber: r.rowNumber, reason: r.reason })),
      },
      kpis: kpiResult,
    };

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

  logUploadOutcome('failure', {
    errorClass: payload.errorClass,
    message: payload.message,
  });

  sendValidated(res, UploadErrorResponseSchema, isValidationError ? 400 : 500, payload);
}
