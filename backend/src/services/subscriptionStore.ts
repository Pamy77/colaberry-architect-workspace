import type { PlanId } from './subscriptionPlans';

/**
 * Holds the account's current subscription (REQ-007, STORY-006; see
 * `directives/07-subscriptions.md`).
 *
 * Walking-skeleton shortcut, same in-process pattern as `latestKpiStore.ts` /
 * `pendingAlertStore.ts` / `financialRecordStore.ts`: a single global value,
 * not a per-user record — this codebase has no account/user system to key
 * on. Lost on restart — durable, per-account persistence is a later story.
 *
 * Defaults to an active `free` subscription, on purpose: nothing is gated
 * until an account either never selects a plan (stays on free, which never
 * expires) or a paid plan's period ends. This is what keeps every existing
 * upload test passing unchanged.
 */

export interface Subscription {
  readonly planId: PlanId;
  /** ISO-8601 timestamp of when this plan was selected. */
  readonly selectedAt: string;
  /** ISO-8601 timestamp this plan stops being active, or null if it never expires (free). */
  readonly expiresAt: string | null;
}

function freeSubscription(): Subscription {
  return { planId: 'free', selectedAt: new Date().toISOString(), expiresAt: null };
}

let current: Subscription = freeSubscription();

export function getCurrentSubscription(): Subscription {
  return current;
}

export function setSubscription(subscription: Subscription): void {
  current = subscription;
}

/** True if `subscription` is usable right now — never expires, or hasn't expired yet. */
export function isActive(subscription: Subscription, now: Date = new Date()): boolean {
  if (subscription.expiresAt === null) return true;
  return now.getTime() < new Date(subscription.expiresAt).getTime();
}

/** Test seam: reset to the default active free subscription between cases. */
export function resetSubscription(): void {
  current = freeSubscription();
}
