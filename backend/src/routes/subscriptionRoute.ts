import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { selectPlan } from '../services/subscriptionService';
import { SelectPlanRequestSchema, SelectPlanResponseSchema } from './subscriptionContract';

/**
 * POST /api/subscription/select — select (or re-select) a subscription plan
 * (STORY-006 / REQ-007). Deterministic and idempotent: selecting the plan
 * you're already active on never charges twice.
 */

export const subscriptionRouter = Router();

subscriptionRouter.post('/subscription/select', async (req: Request, res: Response) => {
  const parsed = SelectPlanRequestSchema.safeParse(req.body);
  const planId = parsed.success ? parsed.data.planId : '';

  const result = await selectPlan(planId);
  res.setHeader('X-Correlation-ID', result.correlationId);

  const status = result.outcome === 'invalid_plan' ? 400 : result.outcome === 'payment_failed' ? 402 : 200;
  sendValidated(res, SelectPlanResponseSchema, status, result);
});
