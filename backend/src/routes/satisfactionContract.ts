import { z } from 'zod';
import type { SatisfactionTrend } from '../services/satisfactionService';

/**
 * Contract for the satisfaction endpoints (STORY-010 / REQ-014):
 *   POST /api/satisfaction/checkin  — submit a quick rating
 *   GET  /api/satisfaction/trend    — is satisfaction trending up, down, or flat
 */

export const SubmitCheckinRequestSchema = z.object({
  rating: z.enum(['great', 'ok', 'not_great']),
});
export type SubmitCheckinRequest = z.infer<typeof SubmitCheckinRequestSchema>;

export const SubmitCheckinResponseSchema = z.object({
  status: z.literal('recorded'),
  id: z.string().min(1),
});
export type SubmitCheckinResponse = z.infer<typeof SubmitCheckinResponseSchema>;

export const SatisfactionTrendResponseSchema = z.object({
  status: z.enum(['increased', 'decreased', 'flat', 'insufficient_data']),
  totalCheckins: z.number().int().nonnegative(),
  earlierAverage: z.number().nullable(),
  laterAverage: z.number().nullable(),
  generatedAt: z.string().min(1),
  correlationId: z.string().min(1),
});
export type SatisfactionTrendResponse = z.infer<typeof SatisfactionTrendResponseSchema>;

export const SatisfactionErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.string().min(1),
  message: z.string().min(1),
});
export type SatisfactionErrorResponse = z.infer<typeof SatisfactionErrorResponseSchema>;

// Compile-time guard: the runtime contract and the service type must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _trendInSync: AssertAssignable<SatisfactionTrend, SatisfactionTrendResponse> = true;
void _trendInSync;
