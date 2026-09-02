import { z } from 'zod';
import type { KpiAlert } from '../services/alertDetectionService';
import type { AlertChannelResult } from '../services/notificationService';

/**
 * Response contract for POST /api/alerts/run (STORY-004 / REQ-005).
 *
 * `status`:
 *   - no_data      — no KPI calculation exists yet
 *   - no_baseline  — only one calculation so far, nothing to compare against
 *   - no_changes   — a comparison ran, nothing cleared the threshold
 *   - already_sent — this exact set of changes was already alerted on
 *   - sent         — at least one channel delivered the alert
 *   - send_failed  — changes were significant but every channel failed
 */

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
  status: z.enum(['no_data', 'no_baseline', 'no_changes', 'already_sent', 'sent', 'send_failed']),
  alertId: z.string().nullable(),
  thresholdPct: z.number(),
  alerts: z.array(KpiAlertSchema),
  channels: z.array(AlertChannelResultSchema),
});
export type AlertRunResponse = z.infer<typeof AlertRunResponseSchema>;

// Compile-time guards: the runtime contract and the service types must not drift.
type AssertAssignable<A, B> = [A] extends [B] ? true : false;
const _alertInSync: AssertAssignable<KpiAlert, z.infer<typeof KpiAlertSchema>> = true;
const _channelInSync: AssertAssignable<AlertChannelResult, z.infer<typeof AlertChannelResultSchema>> = true;
void _alertInSync;
void _channelInSync;
