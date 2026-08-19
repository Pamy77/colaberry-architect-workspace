import path from 'path';
import { Router, Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { sendValidated } from '../lib/sendValidated';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
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

function logUploadOutcome(outcome: 'success' | 'failure', context: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'success' ? 'info' : 'warn',
      service: 'backend',
      event: 'file_upload',
      outcome,
      context,
    }),
  );
}

export const uploadRouter = Router();

uploadRouter.post('/upload', (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      next(err);
      return;
    }

    if (!req.file) {
      next(new UploadValidationError('No file uploaded. Attach a file under the "file" field.'));
      return;
    }

    const payload: UploadSuccessResponse = {
      status: 'accepted',
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
    };

    logUploadOutcome('success', { filename: payload.filename, sizeBytes: payload.sizeBytes });
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
