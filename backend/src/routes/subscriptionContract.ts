import { z } from 'zod';
import type { SelectPlanResult } from '../services/subscriptionService';
import type { Subscription } from '../services/subscriptionStore';

/**
 * Contract for POST /api/subscription/select (STORY-006 / REQ-007).
 *
 * One response shape for every outcome (`updated`, `already_active`,
 * `payment_failed`, `invalid_plan`), same pattern as `alertsContract.ts` —
 * only the HTTP status varies. A malformed or missing `planId` in the
 * request body is not rejected separately; it's passed through as an empty
 * string, which `selectPlan` already handles as `invalid_plan` — one
 * code path, one response shape, and the attempt still gets a real audit
 * line instead of vanishing before it's logged.
 */

export const SelectPlanRequestSchema = z.object({
  planId: z.string().min(1),
});
export type SelectPlanRequest = z.infer<typeof SelectPlanRequestSchema>;

export const SubscriptionSchema = z.object({
  planId: z.enum(['free', 'plan_9', 'plan_19', 'plan_39', 'plan_79']),
  selectedAt: z.string(),
  expiresAt: z.string().nullable(),
});

export const SelectPlanResponseSchema = z.object({
  outcome: z.enum(['updated', 'already_active', 'payment_failed', 'invalid_plan']),
  subscription: SubscriptionSchema.optional(),
  reason: z.string().optional(),
  correlationId: z.string(),
});
export type SelectPlanResponse = z.infer<typeof SelectPlanResponseSchema>;

// Compile-time guards: the runtime contract and the service types must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _subInSync: AssertAssignable<Subscription, z.infer<typeof SubscriptionSchema>> = true;
const _resultInSync: AssertAssignable<SelectPlanResult, SelectPlanResponse> = true;
void _subInSync;
void _resultInSync;
