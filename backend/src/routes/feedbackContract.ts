import { z } from 'zod';
import type { SubmitFeedbackResult, FeedbackStatus } from '../services/feedbackService';

/**
 * Contract for the feedback endpoints (STORY-009 / REQ-011):
 *   POST /api/insights/feedback         — submit feedback on an insight
 *   GET  /api/insights/feedback-status  — which insights still need a prompt
 */

export const SubmitFeedbackRequestSchema = z.object({
  kpiKey: z.string().min(1),
  generatedAt: z.string().min(1),
  rating: z.enum(['accurate', 'inaccurate']),
  comment: z.string().optional(),
});
export type SubmitFeedbackRequest = z.infer<typeof SubmitFeedbackRequestSchema>;

export const FeedbackEntrySchema = z.object({
  id: z.string().min(1),
  kpiKey: z.string().min(1),
  generatedAt: z.string().min(1),
  rating: z.enum(['accurate', 'inaccurate']),
  comment: z.string().nullable(),
  submittedAt: z.string().min(1),
});

export const SubmitFeedbackResponseSchema = z.object({
  outcome: z.enum(['recorded', 'updated', 'insight_not_found']),
  correlationId: z.string().min(1),
  entry: FeedbackEntrySchema.optional(),
});
export type SubmitFeedbackResponse = z.infer<typeof SubmitFeedbackResponseSchema>;

export const FeedbackStatusResponseSchema = z.object({
  generatedAt: z.string().min(1),
  kpiKeysWithFeedback: z.array(z.string()),
  kpiKeysNeedingFeedback: z.array(z.string()),
});
export type FeedbackStatusResponse = z.infer<typeof FeedbackStatusResponseSchema>;

export const FeedbackErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.string().min(1),
  message: z.string().min(1),
});
export type FeedbackErrorResponse = z.infer<typeof FeedbackErrorResponseSchema>;

// Compile-time guards: the runtime contracts and the service types must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _submitInSync: AssertAssignable<SubmitFeedbackResult, SubmitFeedbackResponse> = true;
const _statusInSync: AssertAssignable<FeedbackStatus, FeedbackStatusResponse> = true;
void _submitInSync;
void _statusInSync;
