import type { KpiAlert } from './alertDetectionService';
import type { AlertContent } from './alertTransport';
import type { SendAlertResult } from './notificationService';

/**
 * Holds KPI alerts that cleared the significant-change threshold but have not
 * yet been sent, pending a human's approval or rejection (REQ-013 / STORY-012
 * human-approval hold; see `directives/05-alerts.md`).
 *
 * Walking-skeleton shortcut, same in-process pattern as `latestKpiStore.ts`:
 * a single Map, not a database. Populated by `POST /api/alerts/run` when
 * `ALERT_REQUIRE_APPROVAL` is on (default), read/mutated by the approve/reject
 * endpoints. Lost on restart — durable pending-alert history is STORY-014.
 *
 * Idempotent by construction: entries are keyed by the same deterministic id
 * `deriveAlertKey` already produces, so re-running detection on an unchanged
 * alert set finds the existing entry via `upsertPending` instead of creating a
 * duplicate — there is no separate "already exists?" side-table to keep in
 * sync, the key IS the dedup mechanism.
 */

export type PendingAlertStatus = 'pending' | 'approved' | 'rejected';

export interface PendingAlertEntry {
  readonly id: string;
  readonly alerts: KpiAlert[];
  readonly content: AlertContent;
  readonly generatedAt: string;
  status: PendingAlertStatus;
  /**
   * Set once `approve` has actually invoked `sendKpiAlert` for this entry, so a
   * second `approve` call on an already-approved entry returns the exact same
   * outcome without attempting a second send. This is the idempotency
   * backstop at the route layer, in front of `notificationService`'s own
   * `sentAlertKeys` dedup.
   */
  sendResult?: SendAlertResult;
}

const pendingAlerts = new Map<string, PendingAlertEntry>();

/**
 * Returns the existing entry for `id` if one is already tracked (in any
 * status), or creates a new `pending` entry. Never overwrites an existing
 * entry's alerts/content/status — a replayed detection for the same id is a
 * no-op read of what's already there.
 */
export function upsertPending(
  id: string,
  alerts: KpiAlert[],
  content: AlertContent,
  generatedAt: string,
): PendingAlertEntry {
  const existing = pendingAlerts.get(id);
  if (existing) return existing;
  const entry: PendingAlertEntry = { id, alerts, content, generatedAt, status: 'pending' };
  pendingAlerts.set(id, entry);
  return entry;
}

export function getPendingById(id: string): PendingAlertEntry | undefined {
  return pendingAlerts.get(id);
}

/**
 * Transitions a `pending` entry to `approved` and records the send outcome.
 * A no-op (returns the entry unchanged) if the entry is not currently
 * `pending` — callers must check `status` themselves to decide whether to
 * reuse the cached `sendResult` or reject the request; this function only
 * enforces the valid state transition, it does not decide HTTP semantics.
 */
export function markApproved(id: string, sendResult: SendAlertResult): PendingAlertEntry | undefined {
  const entry = pendingAlerts.get(id);
  if (!entry) return undefined;
  if (entry.status === 'pending') {
    entry.status = 'approved';
    entry.sendResult = sendResult;
  }
  return entry;
}

/**
 * Transitions a `pending` entry to `rejected`. A no-op (returns the entry
 * unchanged) if the entry is not currently `pending` — rejecting twice is
 * idempotent (stays `rejected`); rejecting an already-`approved` entry is left
 * unchanged so the caller can detect the mismatch and refuse the request.
 */
export function markRejected(id: string): PendingAlertEntry | undefined {
  const entry = pendingAlerts.get(id);
  if (!entry) return undefined;
  if (entry.status === 'pending') {
    entry.status = 'rejected';
  }
  return entry;
}

/** Currently pending entries, newest first. */
export function listPending(): PendingAlertEntry[] {
  return Array.from(pendingAlerts.values())
    .filter((e) => e.status === 'pending')
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

/** Test seam: reset the in-process pending-alert store between cases. */
export function clearPendingAlerts(): void {
  pendingAlerts.clear();
}
