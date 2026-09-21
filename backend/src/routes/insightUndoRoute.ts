import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { undoInsightChange } from '../services/insightVersionService';
import {
  UndoErrorResponse,
  UndoErrorResponseSchema,
  UndoRequestSchema,
  UndoResponseSchema,
} from './insightUndoContract';

/**
 * POST /api/insights/undo — undo the most recent feedback change on an
 * insight (STORY-014 / REQ-010; see `directives/13-insight-undo.md`).
 */

export const insightUndoRouter = Router();

insightUndoRouter.post('/insights/undo', (req: Request, res: Response) => {
  const parsed = UndoRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: UndoErrorResponse = {
      status: 'error',
      errorClass: 'ValidationError',
      message: 'kpiKey and generatedAt are required.',
    };
    sendValidated(res, UndoErrorResponseSchema, 400, payload);
    return;
  }

  try {
    const result = undoInsightChange(parsed.data.kpiKey, parsed.data.generatedAt);
    res.setHeader('X-Correlation-ID', result.correlationId);
    sendValidated(res, UndoResponseSchema, 200, result);
  } catch (_err) {
    // "Undo operation failure": currently unreachable (undo is a pure,
    // synchronous read+write of in-memory state), but present
    // defensively, same shape as every other route's catch-all here.
    const payload: UndoErrorResponse = {
      status: 'error',
      errorClass: 'UndoUnavailable',
      message: 'The undo could not be completed. Try again in a moment.',
    };
    sendValidated(res, UndoErrorResponseSchema, 502, payload);
  }
});
