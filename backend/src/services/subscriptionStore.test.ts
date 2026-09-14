import {
  getCurrentSubscription,
  isActive,
  resetSubscription,
  setSubscription,
  type Subscription,
} from './subscriptionStore';

beforeEach(() => {
  resetSubscription();
});

describe('default state', () => {
  it('starts on an active free subscription', () => {
    const sub = getCurrentSubscription();
    expect(sub.planId).toBe('free');
    expect(sub.expiresAt).toBeNull();
    expect(isActive(sub)).toBe(true);
  });
});

describe('setSubscription', () => {
  it('replaces the current subscription', () => {
    const paid: Subscription = {
      planId: 'plan_9',
      selectedAt: '2026-09-14T00:00:00.000Z',
      expiresAt: '2026-10-14T00:00:00.000Z',
    };
    setSubscription(paid);
    expect(getCurrentSubscription()).toEqual(paid);
  });
});

describe('isActive', () => {
  it('a free subscription (expiresAt: null) is always active', () => {
    const free: Subscription = { planId: 'free', selectedAt: 'T0', expiresAt: null };
    expect(isActive(free, new Date('2099-01-01'))).toBe(true);
  });

  it('a paid subscription is active before its expiry', () => {
    const paid: Subscription = { planId: 'plan_9', selectedAt: 'T0', expiresAt: '2026-10-14T00:00:00.000Z' };
    expect(isActive(paid, new Date('2026-10-01T00:00:00.000Z'))).toBe(true);
  });

  it('a paid subscription is not active after its expiry', () => {
    const paid: Subscription = { planId: 'plan_9', selectedAt: 'T0', expiresAt: '2026-10-14T00:00:00.000Z' };
    expect(isActive(paid, new Date('2026-10-15T00:00:00.000Z'))).toBe(false);
  });

  it('the exact expiry instant is no longer active (strict "now < expiresAt")', () => {
    const paid: Subscription = { planId: 'plan_9', selectedAt: 'T0', expiresAt: '2026-10-14T00:00:00.000Z' };
    expect(isActive(paid, new Date('2026-10-14T00:00:00.000Z'))).toBe(false);
  });
});

describe('resetSubscription', () => {
  it('restores the default active free subscription', () => {
    setSubscription({ planId: 'plan_79', selectedAt: 'T0', expiresAt: null });
    resetSubscription();
    expect(getCurrentSubscription().planId).toBe('free');
  });
});
