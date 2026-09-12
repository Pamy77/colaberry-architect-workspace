import { z } from 'zod';
import type { KpiAlert } from '../services/alertDetectionService';
import type { AlertContent } from '../services/alertTransport';
import type { AlertChannelResult } from '../services/notificationService';
import type { PendingAlertEntry } from '../services/pendingAlertStore';

/**
 * Response contract for POST /api/alerts/run (STORY-004 / REQ-005) and the
 * human-approval-hold endpoints it feeds (STORY-012 / REQ-013):
 * POST /api/alerts/:id/approve, POST /api/alerts/:id/reject,
 * GET /api/alerts/pending.
 *
 * `status` on POST /api/alerts/run:
 *   - no_data          — no KPI calculation exists yet
 *   - no_baseline      — only one calculation so far, nothing to compare against
 *   - no_changes       — a comparison ran, nothing cleared the threshold
 *   - pending_approval — significant changes drafted, awaiting human approval
 *                        (ALERT_REQUIRE_APPROVAL=true, the default)
 *   - already_sent     — this exact set of changes was already alerted on
 *                        (gate off only — under the gate, a replay finds the
 *                        existing pending/approved entry and reports
 *                        pending_approval instead; see alertsRoute.ts)
 *   - sent             — at least one channel delivered the alert
 *                        (gate off, or via a prior approve call)
 *   - send_failed      — changes were significant but every channel failed
 */

export const AlertContentSchema = z.object({
  subject: z.string().min(1),
  bodyText: z.string().min(1),
  alertCount: z.number(),
});

export const KpiAlertSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  unit: z.enum(['currency', 'ratio', 'number']),
  previousValue: z.number(),
  currentValue: z.number(),
  absoluteChange: z.number(),
  percentChange: z.number().nullable(),
  direction: z.enum(['increase', 'decrease']),
  evidenceLevel: z.enum(['high', 'medium', 'low']),
  thresholdPct: z.number(),
  reason: z.string().min(1),
});

export const AlertChannelResultSchema = z.object({
  channel: z.string().min(1),
  mode: z.string().min(1),
  outcome: z.enum(['sent', 'failed']),
  error: z.string().optional(),
});

export const AlertRunResponseSchema = z.object({
  status: z.enum([
    'no_data',
    'no_baseline',
    'no_changes',
    'pending_approval',
    'already_sent',
    'sent',
    'send_failed',
  ]),
  alertId: z.string().nullable(),
  thresholdPct: z.number(),
  alerts: z.array(KpiAlertSchema),
  channels: z.array(AlertChannelResultSchema),
  /** The drafted alert content, present only for `pending_approval`. */
  content: AlertContentSchema.nullable(),
});
export type AlertRunResponse = z.infer<typeof AlertRunResponseSchema>;

/**
 * Response contract for POST /api/alerts/:id/approve (STORY-012 / REQ-013).
 *
 * `sent`        — the human-approval hold cleared and at least one channel delivered.
 * `send_failed` — approval was granted but every channel failed (HTTP 502).
 */
export const ApproveAlertResponseSchema = z.object({
  status: z.enum(['sent', 'send_failed']),
  alertId: z.string().min(1),
  alerts: z.array(KpiAlertSchema),
  channels: z.array(AlertChannelResultSchema),
});
export type ApproveAlertResponse = z.infer<typeof ApproveAlertResponseSchema>;

/** Response contract for POST /api/alerts/:id/reject (STORY-012 / REQ-013). */
export const RejectAlertResponseSchema = z.object({
  status: z.literal('rejected'),
  alertId: z.string().min(1),
});
export type RejectAlertResponse = z.infer<typeof RejectAlertResponseSchema>;

/**
 * Shared error shape for the approve/reject endpoints when the id is unknown
 * or the requested transition conflicts with the entry's current status —
 * always an explicit 4xx, never a silent no-op that looks like success.
 */
export const AlertActionErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.enum(['NotFound', 'AlreadyRejected', 'AlreadyApproved']),
  message: z.string().min(1),
});
export type AlertActionErrorResponse = z.infer<typeof AlertActionErrorResponseSchema>;

/** One entry in the GET /api/alerts/pending listing (STORY-012 / REQ-013). */
export const PendingAlertEntrySchema = z.object({
  id: z.string().min(1),
  alerts: z.array(KpiAlertSchema),
  content: AlertContentSchema,
  generatedAt: z.string().min(1),
});

export const PendingAlertListResponseSchema = z.object({
  pending: z.array(PendingAlertEntrySchema),
});
export type PendingAlertListResponse = z.infer<typeof PendingAlertListResponseSchema>;

// Compile-time guards: the runtime contract and the service types must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _alertInSync: AssertAssignable<KpiAlert, z.infer<typeof KpiAlertSchema>> = true;
const _channelInSync: AssertAssignable<AlertChannelResult, z.infer<typeof AlertChannelResultSchema>> = true;
const _contentInSync: AssertAssignable<AlertContent, z.infer<typeof AlertContentSchema>> = true;
const _pendingEntryInSync: AssertAssignable<
  Pick<PendingAlertEntry, 'id' | 'alerts' | 'content' | 'generatedAt'>,
  z.infer<typeof PendingAlertEntrySchema>
> = true;
void _alertInSync;
void _channelInSync;
void _contentInSync;
void _pendingEntryInSync;
