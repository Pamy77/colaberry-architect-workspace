import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { getFeedbackStatus, submitFeedback } from '../services/feedbackService';
import {
  FeedbackErrorResponse,
  FeedbackErrorResponseSchema,
  FeedbackStatusResponseSchema,
  SubmitFeedbackRequestSchema,
  SubmitFeedbackResponseSchema,
} from './feedbackContract';

/**
 * Feedback on insights (STORY-009 / REQ-011):
 *   POST /api/insights/feedback         — submit feedback (idempotent per insight)
 *   GET  /api/insights/feedback-status  — which insights still need a prompt
 */

export const feedbackRouter = Router();

feedbackRouter.post('/insights/feedback', (req: Request, res: Response) => {
  const parsed = SubmitFeedbackRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: FeedbackErrorResponse = {
      status: 'error',
      errorClass: 'ValidationError',
      message: 'kpiKey, generatedAt, and a rating of "accurate" or "inaccurate" are required.',
    };
    sendValidated(res, FeedbackErrorResponseSchema, 400, payload);
    return;
  }

  const result = submitFeedback(parsed.data);
  // Same id in the header and the body — the fix already made repeatedly
  // this session (syncRoute.ts, reportRoute.ts, detailedReportRoute.ts).
  res.setHeader('X-Correlation-ID', result.correlationId);

  // insight_not_found -> 404, same "unknown reference, never a silent
  // no-op" rule alertsRoute.ts uses for an unknown pending-alert id.
  const status = result.outcome === 'insight_not_found' ? 404 : 200;
  sendValidated(res, SubmitFeedbackResponseSchema, status, result);
});

feedbackRouter.get('/insights/feedback-status', (req: Request, res: Response) => {
  res.setHeader('X-Correlation-ID', randomUUID());
  const generatedAt = typeof req.query.generatedAt === 'string' ? req.query.generatedAt : '';
  const status = getFeedbackStatus(generatedAt);
  sendValidated(res, FeedbackStatusResponseSchema, 200, status);
});
