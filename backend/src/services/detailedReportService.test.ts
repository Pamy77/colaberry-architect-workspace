import { generateDetailedReport } from './detailedReportService';
import { clearLatest, setLatest } from './latestKpiStore';
import { clearRecords, upsertRecord } from './financialRecordStore';
import { clearDecisions, recordDecision } from './decisionLog';
import type { KpiCalculation } from './kpiService';

function auditLines(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

function calc(): KpiCalculation {
  return {
    status: 'ok',
    kpis: [
      {
        key: 'business.revenue.total',
        label: 'Total revenue',
        value: 5000,
        unit: 'currency',
        evidenceLevel: 'high',
        evidenceNote: '5 of 5 row(s) had a numeric value (100% coverage).',
        basis: { column: 'revenue', rowsConsidered: 5, rowsUsed: 5, coverage: 1 },
      },
    ],
    clarificationsNeeded: [],
    summary: { totalDataRows: 5, cleanedRowCount: 5, flaggedRowCount: 0, numericColumns: ['revenue'] },
  };
}

function seedAllThreeSources(): void {
  setLatest({ result: calc(), filename: 'sales.csv', generatedAt: '2026-09-19T00:00:00.000Z' });
  upsertRecord({
    source: 'quickbooks',
    externalId: 'qb-1',
    fields: { date: '2026-09-01', amount: '100' },
    fetchedAt: '2026-09-19T00:00:00.000Z',
  });
  recordDecision({ type: 'subscription_change', summary: 'Subscribed to $9/month', context: { planId: 'plan_9' } });
}

beforeEach(() => {
  clearLatest();
  clearRecords();
  clearDecisions();
});

describe('generateDetailedReport — happy path (acceptance #1)', () => {
  it('all three sources present: ok, every section populated with correct counts', () => {
    seedAllThreeSources();

    const report = generateDetailedReport();

    expect(report.status).toBe('ok');
    expect(report.missingDataSources).toEqual([]);
    expect(report.kpis?.result.kpis).toHaveLength(1);
    expect(report.financial?.recordCount).toBe(report.financial?.records.length);
    expect(report.financial?.recordCount).toBe(1);
    expect(report.decisions?.decisionCount).toBe(report.decisions?.entries.length);
    expect(report.decisions?.decisionCount).toBe(1);
  });

  it('the sources filter narrows which sections are populated', () => {
    seedAllThreeSources();

    const report = generateDetailedReport({ sources: ['kpis'] });

    expect(report.sourcesRequested).toEqual(['kpis']);
    expect(report.kpis).not.toBeNull();
    expect(report.financial).toBeNull();
    expect(report.decisions).toBeNull();
    expect(report.status).toBe('ok'); // the one requested source is present
  });
});

describe('generateDetailedReport — incomplete data (acceptance #2)', () => {
  it('one missing source: incomplete, names exactly that source, other sections still populated', () => {
    setLatest({ result: calc(), filename: 'sales.csv', generatedAt: 'T1' });
    // financial and decisions left empty

    const report = generateDetailedReport();

    expect(report.status).toBe('incomplete');
    expect(report.missingDataSources).toEqual(['financial', 'decisions']);
    expect(report.kpis).not.toBeNull();
    expect(report.financial).toBeNull();
    expect(report.decisions).toBeNull();
  });

  it('every source missing: incomplete, names all three, nothing fabricated', () => {
    const report = generateDetailedReport();

    expect(report.status).toBe('incomplete');
    expect(report.missingDataSources).toEqual(['kpis', 'financial', 'decisions']);
    expect(report.kpis).toBeNull();
    expect(report.financial).toBeNull();
    expect(report.decisions).toBeNull();
  });
});

describe('generateDetailedReport — report template error', () => {
  it('an unrecognized templateId is invalid_template, and touches no data source', () => {
    seedAllThreeSources();

    const report = generateDetailedReport({ templateId: 'quarterly_pdf' });

    expect(report.status).toBe('invalid_template');
    expect(report.templateId).toBe('quarterly_pdf'); // echoed back
    expect(report.sourcesRequested).toEqual([]);
    expect(report.kpis).toBeNull();
    expect(report.financial).toBeNull();
    expect(report.decisions).toBeNull();
  });
});

describe('generateDetailedReport — audit logging (Trust acceptance criterion + logging failure guard)', () => {
  it('logs the parameters used and a timestamp on the happy path', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    seedAllThreeSources();

    const report = generateDetailedReport({ sources: ['kpis', 'financial'] });

    const line = auditLines(logSpy).find((l) => l.event === 'detailed_report_generated');
    expect(line).toMatchObject({
      status: 'ok',
      templateId: 'full_detail',
      sourcesRequested: ['kpis', 'financial'],
      correlation_id: report.correlationId,
    });
    expect(typeof line?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('also logs on the incomplete path', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    generateDetailedReport();
    const line = auditLines(logSpy).find((l) => l.event === 'detailed_report_generated');
    expect(line).toMatchObject({ status: 'incomplete' });
    logSpy.mockRestore();
  });

  it('also logs on the invalid_template path — a rejected attempt is still logged', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    generateDetailedReport({ templateId: 'bogus' });
    const line = auditLines(logSpy).find((l) => l.event === 'detailed_report_generated');
    expect(line).toMatchObject({ status: 'invalid_template', templateId: 'bogus' });
    logSpy.mockRestore();
  });
});
