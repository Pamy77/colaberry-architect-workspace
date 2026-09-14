import { randomUUID } from 'crypto';
import type { PlanId } from './subscriptionPlans';

/**
 * Charges an account for a subscription plan (STORY-006 / REQ-007; see
 * `directives/07-subscriptions.md`).
 *
 * A processor knows *how* to charge (or, for now, how to simulate that);
 * `subscriptionService.selectPlan` owns *whether* to charge and *what to do*
 * with the result. Same shape as `alertTransport.ts` for email/Slack: one
 * interface, one dry-run implementation today, a real one behind an env
 * gate later.
 */

export interface PaymentReceipt {
  reference: string;
  planId: PlanId;
  amountUsd: number;
}

export interface PaymentProcessor {
  /** Short description of the charge mode, for logs (e.g. "payment:dry-run"). */
  readonly mode: string;
  /** Resolves with a receipt on success; throws on failure (caught by the caller's runStep retry). */
  charge(planId: PlanId, amountUsd: number): Promise<PaymentReceipt>;
}

/**
 * One structured line per charge attempt — part of this story's Trust
 * criterion ("logs all subscription changes"), and the payment-specific
 * half of that trail. A dry-run charge still leaves a real record of what
 * would have been charged.
 */
function logPaymentAttempt(
  mode: string,
  outcome: 'simulated' | 'charged' | 'failed',
  planId: PlanId,
  amountUsd: number,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: outcome === 'failed' ? 'error' : 'info',
      service: 'backend',
      event: 'payment_attempt',
      mode,
      outcome,
      planId,
      amountUsd,
    }),
  );
}

function dryRunPaymentProcessor(mode: string): PaymentProcessor {
  return {
    mode,
    async charge(planId: PlanId, amountUsd: number): Promise<PaymentReceipt> {
      logPaymentAttempt(mode, 'simulated', planId, amountUsd);
      return { reference: `dry-run-${randomUUID()}`, planId, amountUsd };
    },
  };
}

export function createPaymentProcessor(): PaymentProcessor {
  if (process.env.STRIPE_API_KEY) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'backend',
        event: 'payment_processor_config',
        message:
          'STRIPE_API_KEY is set but the real payment adapter is not built yet (STORY-006 harden). Falling back to dry-run.',
      }),
    );
    return dryRunPaymentProcessor('payment:dry-run(key-present)');
  }
  return dryRunPaymentProcessor('payment:dry-run');
}
