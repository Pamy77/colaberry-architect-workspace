import { randomUUID } from 'crypto';
import { listDecisions, type DecisionEntry } from './decisionLog';

/**
 * Generates a summary report of decisions made (STORY-008 / REQ-012; see
 * `directives/09-summary-reports.md`).
 *
 * Pure and synchronous: a report is a read of `decisionLog`, not a side
 * effect, so generating the same report twice returns the same content —
 * nothing here needs its own idempotency key. `status: 'no_actions'` is an
 * explicit, typed outcome for an empty log, the same shape
 * `dashboardRoute.ts` uses for `no_data`, not an empty array a caller has
 * to interpret for themselves.
 */

export type SummaryReportStatus = 'ok' | 'no_actions';

export interface SummaryReport {
  status: SummaryReportStatus;
  generatedAt: string;
  correlationId: string;
  decisionCount: number;
  decisions: DecisionEntry[];
}

/** One structured line per report generated — the Trust criterion for this story. */
function logReportGenerated(report: SummaryReport): void {
  console.log(
    JSON.stringify({
      timestamp: report.generatedAt,
      level: 'info',
      service: 'backend',
      event: 'report_generated',
      correlation_id: report.correlationId,
      status: report.status,
      decisionCount: report.decisionCount,
    }),
  );
}

export function generateSummaryReport(): SummaryReport {
  const decisions = listDecisions();
  const report: SummaryReport = {
    status: decisions.length === 0 ? 'no_actions' : 'ok',
    generatedAt: new Date().toISOString(),
    correlationId: randomUUID(),
    decisionCount: decisions.length,
    decisions,
  };
  logReportGenerated(report);
  return report;
}
