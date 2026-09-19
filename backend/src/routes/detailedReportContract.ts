import { z } from 'zod';
import type { DetailedReport } from '../services/detailedReportService';
import { KpiResultSchema } from './uploadContract';
import { DecisionEntrySchema } from './reportContract';

/**
 * Contract for GET /api/reports/detailed (STORY-013 / REQ-016). A pure
 * read, parameterized by query string (`sources`, `templateId`) — same
 * shape as `reportContract.ts` (STORY-008), extended with parameters since
 * this read takes them and that one didn't.
 *
 * Reuses `KpiResultSchema` (uploadContract.ts) and `DecisionEntrySchema`
 * (reportContract.ts) rather than redefining shapes this codebase already
 * has contracts for.
 */

export const DataSourceNameSchema = z.enum(['kpis', 'financial', 'decisions']);

export const SyncRecordSchema = z.object({
  source: z.enum(['google_sheets', 'quickbooks']),
  externalId: z.string(),
  fields: z.record(z.string()),
  fetchedAt: z.string().min(1),
});

export const KpiReportSectionSchema = z.object({
  filename: z.string().min(1),
  generatedAt: z.string().min(1),
  result: KpiResultSchema,
});

export const FinancialReportSectionSchema = z.object({
  records: z.array(SyncRecordSchema),
  recordCount: z.number().int().nonnegative(),
});

export const DecisionsReportSectionSchema = z.object({
  entries: z.array(DecisionEntrySchema),
  decisionCount: z.number().int().nonnegative(),
});

export const DetailedReportResponseSchema = z.object({
  status: z.enum(['ok', 'incomplete', 'invalid_template']),
  templateId: z.string(),
  generatedAt: z.string().min(1),
  correlationId: z.string().min(1),
  sourcesRequested: z.array(DataSourceNameSchema),
  missingDataSources: z.array(DataSourceNameSchema),
  kpis: KpiReportSectionSchema.nullable(),
  financial: FinancialReportSectionSchema.nullable(),
  decisions: DecisionsReportSectionSchema.nullable(),
});
export type DetailedReportResponse = z.infer<typeof DetailedReportResponseSchema>;

export const DetailedReportErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.string().min(1),
  message: z.string().min(1),
});
export type DetailedReportErrorResponse = z.infer<typeof DetailedReportErrorResponseSchema>;

// Compile-time guard: the runtime contract and the service type must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _reportInSync: AssertAssignable<DetailedReport, DetailedReportResponse> = true;
void _reportInSync;
