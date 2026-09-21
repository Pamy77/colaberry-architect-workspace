import { z } from 'zod';
import type { UndoResult } from '../services/insightVersionService';

/**
 * Contract for POST /api/insights/undo (STORY-014 / REQ-010).
 * `restored`/`irreversible` are both `200` — an expected outcome, same
 * pattern this codebase already uses for `no_data`/`no_actions`/
 * `insufficient_data`, not a 4xx.
 */

export const UndoRequestSchema = z.object({
  kpiKey: z.string().min(1),
  generatedAt: z.string().min(1),
});
export type UndoRequest = z.infer<typeof UndoRequestSchema>;

export const UndoResponseSchema = z.object({
  outcome: z.enum(['restored', 'irreversible']),
  restoredRating: z.enum(['accurate', 'inaccurate']).optional(),
  restoredComment: z.string().nullable().optional(),
  correlationId: z.string().min(1),
});
export type UndoResponse = z.infer<typeof UndoResponseSchema>;

export const UndoErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.string().min(1),
  message: z.string().min(1),
});
export type UndoErrorResponse = z.infer<typeof UndoErrorResponseSchema>;

// Compile-time guard: the runtime contract and the service type must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _undoInSync: AssertAssignable<UndoResult, UndoResponse> = true;
void _undoInSync;
