import { z } from 'zod';
import { KpiResultSchema } from './uploadContract';

/**
 * Response contract for GET /api/kpis (the dashboard data endpoint, STORY-003).
 *
 * Two shapes, discriminated by `status`:
 *   - `no_data`  — nothing has been calculated yet (drives the dashboard's
 *     "no data" message)
 *   - `ok` / `needs_clarification` — the latest KPI calculation, plus which
 *     file it came from and when it was produced
 */

export const DashboardNoDataSchema = z.object({
  status: z.literal('no_data'),
  generatedAt: z.null(),
});

// Reuse the KPI result contract from the upload endpoint (status + kpis +
// clarificationsNeeded + summary) and add the dashboard-only fields.
export const DashboardKpisSchema = KpiResultSchema.extend({
  generatedAt: z.string().min(1),
  filename: z.string().min(1),
});

export const DashboardResponseSchema = z.union([DashboardNoDataSchema, DashboardKpisSchema]);
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

export const DashboardErrorResponseSchema = z.object({
  status: z.literal('error'),
  errorClass: z.string().min(1),
  message: z.string().min(1),
});
export type DashboardErrorResponse = z.infer<typeof DashboardErrorResponseSchema>;
