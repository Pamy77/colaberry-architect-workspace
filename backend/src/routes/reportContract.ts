import { z } from 'zod';
import type { SummaryReport } from '../services/reportService';

/**
 * Contract for GET /api/reports/summary (STORY-008 / REQ-012). A pure read
 * of the decision log — no request body, same shape as `dashboardRoute.ts`.
 */

export const DecisionEntrySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['subscription_change', 'alert_approved', 'alert_rejected']),
  summary: z.string().min(1),
  occurredAt: z.string().min(1),
  context: z.record(z.unknown()),
});

export const SummaryReportResponseSchema = z.object({
  status: z.enum(['ok', 'no_actions']),
  generatedAt: z.string().min(1),
  correlationId: z.string().min(1),
  decisionCount: z.number().int().nonnegative(),
  decisions: z.array(DecisionEntrySchema),
});
export type SummaryReportResponse = z.infer<typeof SummaryReportResponseSchema>;

export const ReportErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.string().min(1),
  message: z.string().min(1),
});
export type ReportErrorResponse = z.infer<typeof ReportErrorResponseSchema>;

// Compile-time guard: the runtime contract and the service type must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _reportInSync: AssertAssignable<SummaryReport, SummaryReportResponse> = true;
void _reportInSync;
