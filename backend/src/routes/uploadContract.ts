import { z } from 'zod';
import type { KpiCalculation } from '../services/kpiService';

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

export const KpiSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  unit: z.enum(['currency', 'ratio', 'number']),
  evidenceLevel: z.enum(['high', 'medium', 'low']),
  evidenceNote: z.string(),
  basis: z.object({
    column: z.string().nullable(),
    rowsConsidered: z.number().int().nonnegative(),
    rowsUsed: z.number().int().nonnegative(),
    coverage: z.number().min(0).max(1),
  }),
});

export const ClarificationSchema = z.object({
  code: z.enum([
    'no_data',
    'no_numeric_columns',
    'low_coverage',
    'inconsistent_column',
    'missing_kpi_inputs',
  ]),
  question: z.string().min(1),
  column: z.string().nullable(),
});

export const KpiResultSchema = z.object({
  status: z.enum(['ok', 'needs_clarification']),
  kpis: z.array(KpiSchema),
  clarificationsNeeded: z.array(ClarificationSchema),
  summary: z.object({
    totalDataRows: z.number().int().nonnegative(),
    cleanedRowCount: z.number().int().nonnegative(),
    flaggedRowCount: z.number().int().nonnegative(),
    numericColumns: z.array(z.string()),
  }),
});
export type KpiResult = z.infer<typeof KpiResultSchema>;

// Compile-time guard: the runtime contract above and the KPI service's own
// TypeScript type must stay structurally identical. If either drifts, this
// assignment stops type-checking and the build fails (per CLAUDE.md's
// "breaking contract change = failing build").
type AssertMutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _kpiContractInSyncWithService: AssertMutual<KpiResult, KpiCalculation> = true;
void _kpiContractInSyncWithService;

export const UploadSuccessResponseSchema = z.object({
  status: z.literal('accepted'),
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().min(1),
  cleaning: CleaningSummarySchema,
  kpis: KpiResultSchema,
});
export type UploadSuccessResponse = z.infer<typeof UploadSuccessResponseSchema>;

export const UploadErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.enum(['ValidationError', 'UnknownError']),
  message: z.string().min(1),
});
export type UploadErrorResponse = z.infer<typeof UploadErrorResponseSchema>;
