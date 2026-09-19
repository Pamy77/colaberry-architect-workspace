import { randomUUID } from 'crypto';
import { getLatest } from './latestKpiStore';
import type { KpiCalculation } from './kpiService';
import { listRecords, type SyncRecord } from './financialRecordStore';
import { listDecisions, type DecisionEntry } from './decisionLog';

/**
 * Generates a detailed report for analysts, combining every existing data
 * domain (STORY-013 / REQ-016; see `directives/10-detailed-reports.md`).
 *
 * Read-only reuse of `latestKpiStore` / `financialRecordStore` /
 * `decisionLog` — nothing here writes to, or needs changes in, any of
 * those stores. "Detailed" means each requested section is the full
 * underlying data (every KPI, every record, every decision), not a
 * summary of it — the counterpart to STORY-008's summary report.
 */

export type DataSourceName = 'kpis' | 'financial' | 'decisions';
export type ReportTemplateId = 'full_detail';

const ALL_SOURCES: DataSourceName[] = ['kpis', 'financial', 'decisions'];
const KNOWN_TEMPLATES: ReportTemplateId[] = ['full_detail'];

export interface GenerateDetailedReportParams {
  templateId?: string;
  sources?: DataSourceName[];
}

export type DetailedReportStatus = 'ok' | 'incomplete' | 'invalid_template';

export interface KpiReportSection {
  filename: string;
  generatedAt: string;
  result: KpiCalculation;
}

export interface FinancialReportSection {
  records: SyncRecord[];
  recordCount: number;
}

export interface DecisionsReportSection {
  entries: DecisionEntry[];
  decisionCount: number;
}

export interface DetailedReport {
  status: DetailedReportStatus;
  /** Echoes whatever was requested, even when it's not a known template. */
  templateId: string;
  generatedAt: string;
  correlationId: string;
  sourcesRequested: DataSourceName[];
  missingDataSources: DataSourceName[];
  kpis: KpiReportSection | null;
  financial: FinancialReportSection | null;
  decisions: DecisionsReportSection | null;
}

/**
 * One structured line per generation attempt, on every branch — the Trust
 * criterion ("logged with the parameters used and timestamp") and the
 * guard against the "Logging failure" failure path: nothing here can
 * return without this having been called first.
 */
function logReportAttempt(report: Pick<DetailedReport, 'templateId' | 'status' | 'correlationId' | 'sourcesRequested' | 'missingDataSources'>): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: report.status === 'ok' ? 'info' : 'warn',
      service: 'backend',
      event: 'detailed_report_generated',
      correlation_id: report.correlationId,
      templateId: report.templateId,
      sourcesRequested: report.sourcesRequested,
      status: report.status,
      missingDataSources: report.missingDataSources,
    }),
  );
}

export function generateDetailedReport(params: GenerateDetailedReportParams = {}): DetailedReport {
  const correlationId = randomUUID();
  const generatedAt = new Date().toISOString();
  const templateId = params.templateId ?? 'full_detail';
  const sourcesRequested = params.sources ?? ALL_SOURCES;

  // Fail fast on bad input, before touching any data source — same order
  // subscriptionService.selectPlan validates planId before any store access.
  if (!KNOWN_TEMPLATES.includes(templateId as ReportTemplateId)) {
    const report: DetailedReport = {
      status: 'invalid_template',
      templateId,
      generatedAt,
      correlationId,
      sourcesRequested: [],
      missingDataSources: [],
      kpis: null,
      financial: null,
      decisions: null,
    };
    logReportAttempt(report);
    return report;
  }

  const missingDataSources: DataSourceName[] = [];
  let kpis: KpiReportSection | null = null;
  let financial: FinancialReportSection | null = null;
  let decisions: DecisionsReportSection | null = null;

  if (sourcesRequested.includes('kpis')) {
    const latest = getLatest();
    if (latest) {
      kpis = { filename: latest.filename, generatedAt: latest.generatedAt, result: latest.result };
    } else {
      missingDataSources.push('kpis');
    }
  }

  if (sourcesRequested.includes('financial')) {
    const records = listRecords();
    if (records.length > 0) {
      financial = { records, recordCount: records.length };
    } else {
      missingDataSources.push('financial');
    }
  }

  if (sourcesRequested.includes('decisions')) {
    const entries = listDecisions();
    if (entries.length > 0) {
      decisions = { entries, decisionCount: entries.length };
    } else {
      missingDataSources.push('decisions');
    }
  }

  const report: DetailedReport = {
    status: missingDataSources.length > 0 ? 'incomplete' : 'ok',
    templateId,
    generatedAt,
    correlationId,
    sourcesRequested,
    missingDataSources,
    kpis,
    financial,
    decisions,
  };
  logReportAttempt(report);
  return report;
}
