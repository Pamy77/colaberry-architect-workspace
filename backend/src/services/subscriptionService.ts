import { newRun, runStep } from './processingAudit';
import { getPlan, isPlanId, type SubscriptionPlan } from './subscriptionPlans';
import { createPaymentProcessor, type PaymentProcessor } from './paymentProcessor';
import { getCurrentSubscription, isActive, setSubscription, type Subscription } from './subscriptionStore';
import { recordDecision } from './decisionLog';

/**
 * Orchestrates subscription-plan changes and the two upload-time gate checks
 * (REQ-007, STORY-006; see `directives/07-subscriptions.md`).
 *
 * `selectPlan` charges through `processingAudit.runStep` (explicit timeout,
 * capped retries), and only updates the stored subscription on success — a
 * failed charge never leaves the account half-updated. Re-selecting the
 * plan you're already active on is a no-op with no charge attempted, which
 * is the "must not double-charge" guarantee.
 */

export type SelectPlanOutcome = 'updated' | 'already_active' | 'payment_failed' | 'invalid_plan';

export interface SelectPlanResult {
  outcome: SelectPlanOutcome;
  subscription?: Subscription;
  reason?: string;
  correlationId: string;
}

export interface SelectPlanOptions {
  /** Defaults to the configured (dry-run) processor. Overridable for tests. */
  processor?: PaymentProcessor;
  timeoutMs?: number;
  retries?: number;
  /** Injectable delay for tests, forwarded to `runStep`. */
  sleep?: (ms: number) => Promise<void>;
}

const PAYMENT_TIMEOUT_MS = readIntEnv('PAYMENT_TIMEOUT_MS', 10_000);
const PAYMENT_RETRIES = readIntEnv('PAYMENT_RETRIES', 2);

// Placeholder for a real billing calendar — see directives/07-subscriptions.md.
const SUBSCRIPTION_PERIOD_DAYS = 30;

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function logSubscriptionChanged(
  outcome: SelectPlanOutcome,
  correlationId: string,
  context: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'payment_failed' || outcome === 'invalid_plan' ? 'warn' : 'info',
      service: 'backend',
      event: 'subscription_changed',
      correlation_id: correlationId,
      outcome,
      ...context,
    }),
  );
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function selectPlan(planId: string, options: SelectPlanOptions = {}): Promise<SelectPlanResult> {
  const run = newRun();

  if (!isPlanId(planId)) {
    logSubscriptionChanged('invalid_plan', run.runId, { requestedPlanId: planId });
    return { outcome: 'invalid_plan', correlationId: run.runId, reason: `Unknown plan id "${planId}".` };
  }

  const plan = getPlan(planId);
  const current = getCurrentSubscription();

  // Already on this exact plan and it hasn't expired: nothing to do, and
  // nothing to charge. This is the idempotency guarantee — a repeat click
  // or a client retry of the same selection can never double-charge.
  if (current.planId === plan.id && isActive(current)) {
    logSubscriptionChanged('already_active', run.runId, { planId: plan.id });
    return { outcome: 'already_active', subscription: current, correlationId: run.runId };
  }

  if (plan.priceUsd > 0) {
    const processor = options.processor ?? createPaymentProcessor();
    try {
      await runStep(run, 'charge_payment', () => processor.charge(plan.id, plan.priceUsd), {
        timeoutMs: options.timeoutMs ?? PAYMENT_TIMEOUT_MS,
        retries: options.retries ?? PAYMENT_RETRIES,
        sleep: options.sleep,
        context: { planId: plan.id, amountUsd: plan.priceUsd },
      });
    } catch (err) {
      // The charge failed after every retry: the stored subscription is
      // untouched. No partial state — the account is exactly what it was
      // before this call.
      const reason = err instanceof Error ? err.message : 'Unknown error';
      logSubscriptionChanged('payment_failed', run.runId, {
        planId: plan.id,
        amountUsd: plan.priceUsd,
        error: reason,
      });
      return { outcome: 'payment_failed', correlationId: run.runId, reason };
    }
  }

  const now = new Date();
  const updated: Subscription = {
    planId: plan.id,
    selectedAt: now.toISOString(),
    expiresAt: plan.priceUsd === 0 ? null : addDays(now, SUBSCRIPTION_PERIOD_DAYS),
  };
  setSubscription(updated);
  logSubscriptionChanged('updated', run.runId, { planId: plan.id, previousPlanId: current.planId });
  // STORY-008: a real plan change is a decision worth reporting on. Only
  // this branch records one — already_active/payment_failed/invalid_plan
  // changed nothing, so there is nothing to report (directives/09-summary-reports.md).
  recordDecision({
    type: 'subscription_change',
    summary: `Subscribed to ${plan.label} (was ${current.planId})`,
    context: { planId: plan.id, previousPlanId: current.planId, priceUsd: plan.priceUsd },
  });
  return { outcome: 'updated', subscription: updated, correlationId: run.runId };
}

/* ------------------------------------------------------------------ *
 * Upload-time gate checks. Both are pure reads that return a result   *
 * rather than throwing — the route layer decides what HTTP error, if  *
 * any, a blocked result becomes. Both log a subscription_usage line   *
 * on every call, allowed or blocked (the "logs... usage" half of the  *
 * Trust criterion).                                                   *
 * ------------------------------------------------------------------ */

export interface SubscriptionActiveCheck {
  blocked: boolean;
  plan: SubscriptionPlan;
}

export interface UsageLimitCheck {
  blocked: boolean;
  plan: SubscriptionPlan;
  limit: number;
  rowCount: number;
}

function logUsage(check: string, outcome: 'allowed' | 'blocked', context: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'blocked' ? 'warn' : 'info',
      service: 'backend',
      event: 'subscription_usage',
      check,
      outcome,
      ...context,
    }),
  );
}

/** Blocked only for an expired paid plan — `free` never expires. */
export function checkSubscriptionActive(now: Date = new Date()): SubscriptionActiveCheck {
  const sub = getCurrentSubscription();
  const plan = getPlan(sub.planId);
  const active = isActive(sub, now);
  logUsage('active', active ? 'allowed' : 'blocked', { planId: plan.id, expiresAt: sub.expiresAt });
  return { blocked: !active, plan };
}

/** Independent of UPLOAD_MAX_ROWS — this is the plan's own billing-tier limit. */
export function checkUsageLimit(rowCount: number): UsageLimitCheck {
  const sub = getCurrentSubscription();
  const plan = getPlan(sub.planId);
  const blocked = rowCount > plan.maxRowsPerUpload;
  logUsage('usage_limit', blocked ? 'blocked' : 'allowed', {
    planId: plan.id,
    rowCount,
    limit: plan.maxRowsPerUpload,
  });
  return { blocked, plan, limit: plan.maxRowsPerUpload, rowCount };
}
