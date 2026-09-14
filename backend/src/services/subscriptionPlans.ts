/**
 * The subscription plan catalog (REQ-007, STORY-006; see
 * `directives/07-subscriptions.md`).
 *
 * `maxRowsPerUpload` is a documented placeholder: REQ-007 specifies prices,
 * not limit values, so these numbers are an assumption pending real product
 * input, not a guess presented as fact. They are independent of
 * `UPLOAD_MAX_ROWS` in `uploadContract.ts`, which stays exactly as it is —
 * that is a global event-loop-protection cap, not a billing decision.
 */

export type PlanId = 'free' | 'plan_9' | 'plan_19' | 'plan_39' | 'plan_79';

export interface SubscriptionPlan {
  readonly id: PlanId;
  readonly priceUsd: number;
  readonly label: string;
  readonly maxRowsPerUpload: number;
}

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlan[] = [
  { id: 'free', priceUsd: 0, label: 'Free', maxRowsPerUpload: 1_000 },
  { id: 'plan_9', priceUsd: 9, label: '$9/month', maxRowsPerUpload: 5_000 },
  { id: 'plan_19', priceUsd: 19, label: '$19/month', maxRowsPerUpload: 15_000 },
  { id: 'plan_39', priceUsd: 39, label: '$39/month', maxRowsPerUpload: 50_000 },
  { id: 'plan_79', priceUsd: 79, label: '$79/month', maxRowsPerUpload: 200_000 },
];

const PLANS_BY_ID = new Map(SUBSCRIPTION_PLANS.map((p) => [p.id, p]));

export function isPlanId(value: string): value is PlanId {
  return PLANS_BY_ID.has(value as PlanId);
}

export function getPlan(id: PlanId): SubscriptionPlan {
  const plan = PLANS_BY_ID.get(id);
  if (!plan) throw new Error(`Unknown plan id "${id}" — this should be unreachable if isPlanId was checked first.`);
  return plan;
}
