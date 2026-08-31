import { z } from 'zod';

export const UPLOAD_MAX_BYTES = process.env.UPLOAD_MAX_BYTES
  ? Number(process.env.UPLOAD_MAX_BYTES)
  : 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_EXTENSIONS = ['.csv', '.xls', '.xlsx'] as const;

export const UPLOAD_MAX_ROWS = process.env.UPLOAD_MAX_ROWS
  ? Number(process.env.UPLOAD_MAX_ROWS)
  : 50_000;

export const CleaningSummarySchema = z.object({
  headers: z.array(z.string()),
  totalDataRows: z.number().int().nonnegative(),
  cleanedRowCount: z.number().int().nonnegative(),
  flaggedRowCount: z.number().int().nonnegative(),
  flaggedRows: z.array(
    z.object({
      rowNumber: z.number().int().positive(),
      reason: z.string(),
    }),
  ),
});
export type CleaningSummary = z.infer<typeof CleaningSummarySchema>;

export const UploadSuccessResponseSchema = z.object({
  status: z.literal('accepted'),
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1),
  cleaning: CleaningSummarySchema,
});
export type UploadSuccessResponse = z.infer<typeof UploadSuccessResponseSchema>;

export const UploadErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.enum(['ValidationError', 'UnknownError']),
  message: z.string().min(1),
});
export type UploadErrorResponse = z.infer<typeof UploadErrorResponseSchema>;
