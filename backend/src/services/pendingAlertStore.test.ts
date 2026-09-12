import {
  clearPendingAlerts,
  getPendingById,
  listPending,
  markApproved,
  markRejected,
  upsertPending,
} from './pendingAlertStore';
import type { KpiAlert } from './alertDetectionService';
import type { AlertContent } from './alertTransport';
import type { SendAlertResult } from './notificationService';

function alert(key: string): KpiAlert {
  return {
    key,
    label: key,
    unit: 'number',
    previousValue: 100,
    currentValue: 140,
    absoluteChange: 40,
    percentChange: 40,
    direction: 'increase',
    evidenceLevel: 'high',
    thresholdPct: 15,
    reason: `${key} rose 40%`,
  };
}

function content(): AlertContent {
  return { subject: 'KPI alert: 1 significant change', bodyText: '- revenue rose 40%', alertCount: 1 };
}

function sentResult(): SendAlertResult {
  return {
    sent: true,
    alertId: 'irrelevant-route-supplies-its-own-id',
    channels: [{ channel: 'email', mode: 'email:dry-run', outcome: 'sent' }],
  };
}

function failedResult(): SendAlertResult {
  return {
    sent: false,
    alertId: 'irrelevant-route-supplies-its-own-id',
    channels: [{ channel: 'email', mode: 'email:dry-run', outcome: 'failed', error: 'smtp down' }],
  };
}

describe('pendingAlertStore', () => {
  beforeEach(() => clearPendingAlerts());

  describe('upsertPending', () => {
    it('creates a new pending entry', () => {
      const entry = upsertPending('id-1', [alert('revenue')], content(), 'T1');
      expect(entry).toMatchObject({ id: 'id-1', status: 'pending', generatedAt: 'T1' });
      expect(entry.alerts).toHaveLength(1);
      expect(getPendingById('id-1')).toBe(entry);
    });

    it('is idempotent: a second call with the same id returns the existing entry instead of creating a duplicate', () => {
      const first = upsertPending('id-1', [alert('revenue')], content(), 'T1');
      // Different alerts/content/generatedAt passed on the "replay" — the
      // original entry wins, proving this is a real get-or-create, not a
      // last-write-wins overwrite.
      const second = upsertPending('id-1', [alert('expenses')], content(), 'T2');

      expect(second).toBe(first);
      expect(second.alerts[0].key).toBe('revenue');
      expect(second.generatedAt).toBe('T1');
      expect(listPending()).toHaveLength(1);
    });

    it('creates independent entries for different ids', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      upsertPending('id-2', [alert('expenses')], content(), 'T2');
      expect(listPending()).toHaveLength(2);
    });
  });

  describe('markApproved', () => {
    it('transitions a pending entry to approved and records the send result', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      const result = sentResult();

      const entry = markApproved('id-1', result);

      expect(entry?.status).toBe('approved');
      expect(entry?.sendResult).toBe(result);
      expect(listPending()).toEqual([]); // no longer pending
    });

    it('records a failed send result too (approval was granted; delivery failed)', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      const entry = markApproved('id-1', failedResult());
      expect(entry?.status).toBe('approved');
      expect(entry?.sendResult?.sent).toBe(false);
    });

    it('is a no-op on an already-approved entry (does not overwrite the cached result)', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      markApproved('id-1', sentResult());

      const secondResult = failedResult();
      const entry = markApproved('id-1', secondResult);

      expect(entry?.status).toBe('approved');
      expect(entry?.sendResult).not.toBe(secondResult); // first result preserved
      expect(entry?.sendResult?.sent).toBe(true);
    });

    it('does not flip a rejected entry to approved', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      markRejected('id-1');

      const entry = markApproved('id-1', sentResult());

      expect(entry?.status).toBe('rejected');
      expect(entry?.sendResult).toBeUndefined();
    });

    it('returns undefined for an unknown id', () => {
      expect(markApproved('missing', sentResult())).toBeUndefined();
    });
  });

  describe('markRejected', () => {
    it('transitions a pending entry to rejected', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      const entry = markRejected('id-1');
      expect(entry?.status).toBe('rejected');
      expect(listPending()).toEqual([]);
    });

    it('is idempotent: rejecting twice stays rejected, no error', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      markRejected('id-1');
      const entry = markRejected('id-1');
      expect(entry?.status).toBe('rejected');
    });

    it('does not flip an approved entry to rejected', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      markApproved('id-1', sentResult());

      const entry = markRejected('id-1');

      expect(entry?.status).toBe('approved');
    });

    it('returns undefined for an unknown id', () => {
      expect(markRejected('missing')).toBeUndefined();
    });
  });

  describe('listPending', () => {
    it('lists only pending entries, newest first', () => {
      upsertPending('id-1', [alert('revenue')], content(), '2026-01-01T00:00:00Z');
      upsertPending('id-2', [alert('expenses')], content(), '2026-01-03T00:00:00Z');
      upsertPending('id-3', [alert('margin')], content(), '2026-01-02T00:00:00Z');
      markApproved('id-2', sentResult()); // removed from pending

      const pending = listPending();

      expect(pending.map((e) => e.id)).toEqual(['id-3', 'id-1']); // id-3 (Jan 2) before id-1 (Jan 1)
    });

    it('returns an empty array when nothing is pending', () => {
      expect(listPending()).toEqual([]);
    });
  });

  describe('getPendingById', () => {
    it('returns undefined for an unknown id', () => {
      expect(getPendingById('missing')).toBeUndefined();
    });
  });

  describe('clearPendingAlerts', () => {
    it('resets the store', () => {
      upsertPending('id-1', [alert('revenue')], content(), 'T1');
      clearPendingAlerts();
      expect(listPending()).toEqual([]);
      expect(getPendingById('id-1')).toBeUndefined();
    });
  });
});
