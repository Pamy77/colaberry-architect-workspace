import { randomUUID } from 'crypto';

/**
 * Records decisions made in the system, for STORY-008's summary reports
 * (REQ-012; see `directives/09-summary-reports.md`).
 *
 * Walking-skeleton shortcut, same in-process pattern as `latestKpiStore.ts` /
 * `pendingAlertStore.ts` / `financialRecordStore.ts` / `subscriptionStore.ts`:
 * a single global list, not a database. Lost on restart — durable history is
 * a later persistence story, same caveat every other store here carries.
 *
 * A "decision" is recorded at the exact moment it happens — a real
 * subscription plan change, or a human approving/rejecting a drafted alert —
 * never reconstructed later by re-scanning other stores. See the directive
 * for exactly what qualifies and why a no-op or failed attempt does not.
 */

export type DecisionType = 'subscription_change' | 'alert_approved' | 'alert_rejected';

export interface DecisionEntry {
  readonly id: string;
  readonly type: DecisionType;
  /** One human-readable sentence describing what happened. */
  readonly summary: string;
  /** ISO-8601 timestamp of when the decision was made. */
  readonly occurredAt: string;
  readonly context: Record<string, unknown>;
}

const decisions: DecisionEntry[] = [];

export function recordDecision(entry: {
  type: DecisionType;
  summary: string;
  context: Record<string, unknown>;
  occurredAt?: string;
}): DecisionEntry {
  const recorded: DecisionEntry = {
    id: randomUUID(),
    type: entry.type,
    summary: entry.summary,
    occurredAt: entry.occurredAt ?? new Date().toISOString(),
    context: entry.context,
  };
  decisions.push(recorded);
  return recorded;
}

/** Every recorded decision, newest first. */
export function listDecisions(): DecisionEntry[] {
  return [...decisions].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

/** Test seam: reset the in-process decision log between cases. */
export function clearDecisions(): void {
  decisions.length = 0;
}
