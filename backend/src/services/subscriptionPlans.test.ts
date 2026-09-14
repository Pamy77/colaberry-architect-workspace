import { SUBSCRIPTION_PLANS, getPlan, isPlanId } from './subscriptionPlans';

describe('SUBSCRIPTION_PLANS', () => {
  it('has exactly the five REQ-007 price points', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => p.priceUsd)).toEqual([0, 9, 19, 39, 79]);
  });

  it('every plan has a positive row limit, strictly increasing with price', () => {
    const limits = SUBSCRIPTION_PLANS.map((p) => p.maxRowsPerUpload);
    for (const limit of limits) expect(limit).toBeGreaterThan(0);
    for (let i = 1; i < limits.length; i += 1) {
      expect(limits[i]).toBeGreaterThan(limits[i - 1]);
    }
  });
});

describe('isPlanId', () => {
  it('recognizes every real plan id', () => {
    for (const plan of SUBSCRIPTION_PLANS) expect(isPlanId(plan.id)).toBe(true);
  });

  it('rejects an unknown id', () => {
    expect(isPlanId('plan_999')).toBe(false);
    expect(isPlanId('')).toBe(false);
  });
});

describe('getPlan', () => {
  it('returns the matching plan', () => {
    expect(getPlan('plan_9')).toMatchObject({ id: 'plan_9', priceUsd: 9 });
  });
});
