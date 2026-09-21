import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { computeSatisfactionTrend, recordSatisfactionCheckin } from '../services/satisfactionService';
import {
  SatisfactionErrorResponse,
  SatisfactionErrorResponseSchema,
  SatisfactionTrendResponseSchema,
  SubmitCheckinRequestSchema,
  SubmitCheckinResponseSchema,
} from './satisfactionContract';

/**
 * Interface satisfaction (STORY-010 / REQ-014; see the "Satisfaction
 * trend mechanism" section of `directives/12-ui-simplicity.md`):
 *   POST /api/satisfaction/checkin
 *   GET  /api/satisfaction/trend
 */

export const satisfactionRouter = Router();

satisfactionRouter.post('/satisfaction/checkin', (req: Request, res: Response) => {
  const parsed = SubmitCheckinRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: SatisfactionErrorResponse = {
      status: 'error',
      errorClass: 'ValidationError',
      message: 'A rating of "great", "ok", or "not_great" is required.',
    };
    sendValidated(res, SatisfactionErrorResponseSchema, 400, payload);
    return;
  }

  const entry = recordSatisfactionCheckin(parsed.data.rating);
  sendValidated(res, SubmitCheckinResponseSchema, 200, { status: 'recorded', id: entry.id });
});

satisfactionRouter.get('/satisfaction/trend', (_req: Request, res: Response) => {
  const trend = computeSatisfactionTrend();
  res.setHeader('X-Correlation-ID', trend.correlationId);
  sendValidated(res, SatisfactionTrendResponseSchema, 200, trend);
});
