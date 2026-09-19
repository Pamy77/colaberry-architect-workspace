import { z } from 'zod';

/**
 * Contract for POST /api/ui/interactions (STORY-010, Trust criterion:
 * "logs user interactions and feedback on interface changes").
 *
 * Store-free by design — unlike `decisionLog`/`feedbackStore`, nothing in
 * this story's acceptance criteria requires reading these back, so an
 * append-only structured log line is the whole mechanism.
 */

export const LogInteractionRequestSchema = z.object({
  event: z.string().min(1),
  context: z.record(z.unknown()).optional(),
});
export type LogInteractionRequest = z.infer<typeof LogInteractionRequestSchema>;

export const LogInteractionResponseSchema = z.object({
  status: z.literal('logged'),
  correlationId: z.string().min(1),
});
export type LogInteractionResponse = z.infer<typeof LogInteractionResponseSchema>;

export const LogInteractionErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.string().min(1),
  message: z.string().min(1),
});
export type LogInteractionErrorResponse = z.infer<typeof LogInteractionErrorResponseSchema>;
