import { generateSummaryReport } from './reportService';
import { clearDecisions, recordDecision } from './decisionLog';

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

beforeEach(() => {
  clearDecisions();
});

describe('generateSummaryReport — happy path', () => {
  it('includes every recorded decision (acceptance #1)', () => {
    recordDecision({ type: 'subscription_change', summary: 'Subscribed to $9/month', context: { planId: 'plan_9' } });
    recordDecision({ type: 'alert_approved', summary: 'Approved 2 KPI change(s)', context: { alertId: 'a1' } });

    const report = generateSummaryReport();

    expect(report.status).toBe('ok');
    expect(report.decisionCount).toBe(2);
    expect(report.decisions).toHaveLength(2);
    expect(report.decisions.map((d) => d.summary)).toEqual(
      expect.arrayContaining(['Subscribed to $9/month', 'Approved 2 KPI change(s)']),
    );
  });

  it('decisionCount always matches decisions.length (guard against incorrect content)', () => {
    recordDecision({ type: 'alert_rejected', summary: 'x', context: {} });
    const report = generateSummaryReport();
    expect(report.decisionCount).toBe(report.decisions.length);
  });
});

describe('generateSummaryReport — no actions (acceptance #2)', () => {
  it('reports no_actions, not an error, when nothing has been decided', () => {
    const report = generateSummaryReport();
    expect(report.status).toBe('no_actions');
    expect(report.decisionCount).toBe(0);
    expect(report.decisions).toEqual([]);
  });
});

describe('generateSummaryReport — audit logging (Trust acceptance criterion)', () => {
  it('logs a report_generated line with status, count, and a correlation id', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    recordDecision({ type: 'subscription_change', summary: 'x', context: {} });

    const report = generateSummaryReport();

    const line = auditLines(logSpy).find((l) => l.event === 'report_generated');
    expect(line).toMatchObject({ status: 'ok', decisionCount: 1, correlation_id: report.correlationId });
    expect(typeof line?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('also logs when the report is no_actions — a generation attempt is still an activity', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    generateSummaryReport();

    const line = auditLines(logSpy).find((l) => l.event === 'report_generated');
    expect(line).toMatchObject({ status: 'no_actions', decisionCount: 0 });
    logSpy.mockRestore();
  });
});
