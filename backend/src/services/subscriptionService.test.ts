import {
  checkSubscriptionActive,
  checkUsageLimit,
  selectPlan,
} from './subscriptionService';
import { getCurrentSubscription, resetSubscription, setSubscription } from './subscriptionStore';
import type { PaymentProcessor, PaymentReceipt } from './paymentProcessor';
import type { PlanId } from './subscriptionPlans';
import { clearDecisions, listDecisions } from './decisionLog';

function auditLines(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

const noSleep = () => Promise.resolve();

function countingProcessor(): PaymentProcessor & { calls: number } {
  const p = {
    calls: 0,
    mode: 'payment:test',
    async charge(planId: PlanId, amountUsd: number): Promise<PaymentReceipt> {
      p.calls += 1;
      return { reference: `test-${p.calls}`, planId, amountUsd };
    },
  };
  return p;
}

function alwaysFailingProcessor(message: string): PaymentProcessor {
  return {
    mode: 'payment:test-fail',
    async charge(): Promise<PaymentReceipt> {
      throw new Error(message);
    },
  };
}

function flakyProcessor(failuresBeforeSuccess: number): PaymentProcessor & { calls: number } {
  const p = {
    calls: 0,
    mode: 'payment:test-flaky',
    async charge(planId: PlanId, amountUsd: number): Promise<PaymentReceipt> {
      p.calls += 1;
      if (p.calls <= failuresBeforeSuccess) throw new Error('temporary processor blip');
      return { reference: `flaky-${p.calls}`, planId, amountUsd };
    },
  };
  return p;
}

beforeEach(() => {
  resetSubscription();
  clearDecisions();
});

describe('selectPlan — happy path and idempotency', () => {
  it('selecting the default active free plan is a no-op: already_active, nothing charged', async () => {
    const processor = countingProcessor();
    const result = await selectPlan('free', { processor });

    expect(result.outcome).toBe('already_active');
    expect(processor.calls).toBe(0);
  });

  it('selecting a paid plan from free charges once and updates the account', async () => {
    const processor = countingProcessor();
    const result = await selectPlan('plan_9', { processor });

    expect(result.outcome).toBe('updated');
    expect(processor.calls).toBe(1);
    expect(result.subscription).toMatchObject({ planId: 'plan_9' });
    expect(result.subscription?.expiresAt).not.toBeNull();
    expect(getCurrentSubscription().planId).toBe('plan_9');
  });

  it('re-selecting the same active paid plan is idempotent: no second charge', async () => {
    const processor = countingProcessor();
    await selectPlan('plan_9', { processor });
    const second = await selectPlan('plan_9', { processor });

    expect(second.outcome).toBe('already_active');
    expect(processor.calls).toBe(1); // still just the first charge
  });

  it('switching from an active paid plan down to free charges nothing', async () => {
    const processor = countingProcessor();
    await selectPlan('plan_39', { processor });
    const result = await selectPlan('free', { processor });

    expect(result.outcome).toBe('updated');
    expect(processor.calls).toBe(1); // only the original plan_39 charge
    expect(getCurrentSubscription()).toMatchObject({ planId: 'free', expiresAt: null });
  });

  it('renewing the same paid plan after it expired charges again (not a double-charge — a new period)', async () => {
    setSubscription({ planId: 'plan_9', selectedAt: 'T0', expiresAt: '2020-01-01T00:00:00.000Z' }); // already expired
    const processor = countingProcessor();

    const result = await selectPlan('plan_9', { processor });

    expect(result.outcome).toBe('updated');
    expect(processor.calls).toBe(1);
  });
});

describe('selectPlan — failure paths', () => {
  it('an unknown plan id is invalid_plan, and does not touch the stored subscription', async () => {
    const before = getCurrentSubscription();
    const result = await selectPlan('plan_999');

    expect(result.outcome).toBe('invalid_plan');
    expect(getCurrentSubscription()).toEqual(before);
  });

  it('a payment that fails after every retry is payment_failed, and the subscription is unchanged', async () => {
    const before = getCurrentSubscription();
    const result = await selectPlan('plan_19', {
      processor: alwaysFailingProcessor('card declined'),
      retries: 1,
      sleep: noSleep,
    });

    expect(result.outcome).toBe('payment_failed');
    expect(result.reason).toBe('card declined');
    expect(getCurrentSubscription()).toEqual(before); // no partial state
  });

  it('a payment that fails once then recovers within the retry budget still succeeds', async () => {
    const processor = flakyProcessor(1);
    const result = await selectPlan('plan_19', { processor, retries: 2, sleep: noSleep });

    expect(processor.calls).toBe(2);
    expect(result.outcome).toBe('updated');
  });
});

describe('selectPlan — audit logging (Trust acceptance criterion)', () => {
  it('logs a subscription_changed line for every outcome, including the already_active no-op', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await selectPlan('free'); // already_active
    await selectPlan('plan_9', { processor: countingProcessor() }); // updated
    await selectPlan('plan_999'); // invalid_plan

    const lines = auditLines(logSpy).filter((l) => l.event === 'subscription_changed');
    expect(lines.map((l) => l.outcome)).toEqual(['already_active', 'updated', 'invalid_plan']);
    for (const line of lines) expect(typeof line.timestamp).toBe('string');
    logSpy.mockRestore();
  });
});

describe('checkSubscriptionActive', () => {
  it('the default free account is never blocked', () => {
    expect(checkSubscriptionActive().blocked).toBe(false);
  });

  it('an active (unexpired) paid plan is not blocked', () => {
    setSubscription({ planId: 'plan_9', selectedAt: 'T0', expiresAt: '2099-01-01T00:00:00.000Z' });
    expect(checkSubscriptionActive(new Date('2026-01-01')).blocked).toBe(false);
  });

  it('an expired paid plan is blocked', () => {
    setSubscription({ planId: 'plan_9', selectedAt: 'T0', expiresAt: '2020-01-01T00:00:00.000Z' });
    expect(checkSubscriptionActive(new Date('2026-01-01')).blocked).toBe(true);
  });

  it('logs a subscription_usage line either way', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    checkSubscriptionActive();
    const line = auditLines(logSpy).find((l) => l.event === 'subscription_usage' && l.check === 'active');
    expect(line).toMatchObject({ outcome: 'allowed' });
    logSpy.mockRestore();
  });
});

describe('checkUsageLimit', () => {
  it('a row count within the plan limit is not blocked', () => {
    // default plan is free, limit 1,000
    expect(checkUsageLimit(500).blocked).toBe(false);
  });

  it('a row count over the plan limit is blocked', () => {
    expect(checkUsageLimit(1_500).blocked).toBe(true);
  });

  it('the limit scales with the active plan, independent of the global UPLOAD_MAX_ROWS cap', () => {
    setSubscription({ planId: 'plan_79', selectedAt: 'T0', expiresAt: null });
    const result = checkUsageLimit(150_000); // over free's limit, well under plan_79's 200,000
    expect(result.blocked).toBe(false);
    expect(result.limit).toBe(200_000);
  });

  it('logs a subscription_usage line either way', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    checkUsageLimit(2_000);
    const line = auditLines(logSpy).find((l) => l.event === 'subscription_usage' && l.check === 'usage_limit');
    expect(line).toMatchObject({ outcome: 'blocked', rowCount: 2000, limit: 1000 });
    logSpy.mockRestore();
  });
});

describe('selectPlan — decision recording (STORY-008)', () => {
  it('a real plan change records exactly one decision', async () => {
    await selectPlan('plan_9', { processor: countingProcessor() });
    expect(listDecisions()).toHaveLength(1);
    expect(listDecisions()[0]).toMatchObject({ type: 'subscription_change' });
  });

  it('already_active (no-op) records no decision', async () => {
    await selectPlan('free'); // default is already free and active
    expect(listDecisions()).toHaveLength(0);
  });

  it('payment_failed records no decision — nothing changed, so nothing to report', async () => {
    await selectPlan('plan_19', {
      processor: alwaysFailingProcessor('card declined'),
      retries: 0,
      sleep: noSleep,
    });
    expect(listDecisions()).toHaveLength(0);
  });

  it('invalid_plan records no decision', async () => {
    await selectPlan('plan_999');
    expect(listDecisions()).toHaveLength(0);
  });
});
