import { submitFeedback, getFeedbackStatus } from './feedbackService';
import { clearLatest, setLatest } from './latestKpiStore';
import { clearFeedback, getFeedback } from './feedbackStore';
import { clearVersions, listVersions } from './insightVersionStore';
import type { KpiCalculation, EvidenceLevel } from './kpiService';

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

function calc(evidenceLevel: EvidenceLevel = 'high'): KpiCalculation {
  return {
    status: 'ok',
    kpis: [
      {
        key: 'business.revenue.total',
        label: 'Total revenue',
        value: 5000,
        unit: 'currency',
        evidenceLevel,
        evidenceNote: 'note',
        basis: { column: 'revenue', rowsConsidered: 5, rowsUsed: 5, coverage: 1 },
      },
    ],
    clarificationsNeeded: [],
    summary: { totalDataRows: 5, cleanedRowCount: 5, flaggedRowCount: 0, numericColumns: ['revenue'], dateRange: null, monthlySeries: [] },
  };
}

function seed(evidenceLevel: EvidenceLevel = 'high', generatedAt = 'T1'): void {
  setLatest({ result: calc(evidenceLevel), filename: 'sales.csv', generatedAt });
}

beforeEach(() => {
  clearLatest();
  clearFeedback();
  clearVersions();
});

describe('submitFeedback — happy path (acceptance #1)', () => {
  it('records feedback against a real insight in the latest calculation', () => {
    seed('high', 'T1');

    const result = submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    expect(result.outcome).toBe('recorded');
    expect(getFeedback('business.revenue.total', 'T1')?.rating).toBe('accurate');
  });

  it('resubmitting for the same insight is updated, not a duplicate', () => {
    seed('high', 'T1');
    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    const second = submitFeedback({
      kpiKey: 'business.revenue.total',
      generatedAt: 'T1',
      rating: 'inaccurate',
      comment: 'seems off',
    });

    expect(second.outcome).toBe('updated');
    expect(getFeedback('business.revenue.total', 'T1')?.rating).toBe('inaccurate');
  });
});

describe('submitFeedback — feedback not recorded (failure path)', () => {
  it('an unknown kpiKey is insight_not_found, and nothing is stored', () => {
    seed('high', 'T1');
    const result = submitFeedback({ kpiKey: 'not.a.real.kpi', generatedAt: 'T1', rating: 'accurate' });

    expect(result.outcome).toBe('insight_not_found');
    expect(getFeedback('not.a.real.kpi', 'T1')).toBeUndefined();
  });

  it('a stale generatedAt (not the current latest) is insight_not_found', () => {
    seed('high', 'T2'); // latest is now T2
    const result = submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    expect(result.outcome).toBe('insight_not_found');
  });

  it('no calculation at all is insight_not_found', () => {
    const result = submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    expect(result.outcome).toBe('insight_not_found');
  });
});

describe('submitFeedback — impact + audit logging (Trust acceptance criterion)', () => {
  it('logs a confirming impact note for accurate feedback on a high-confidence KPI', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    seed('high', 'T1');

    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    const line = auditLines(logSpy).find((l) => l.event === 'feedback_received');
    expect(line).toMatchObject({ outcome: 'recorded', rating: 'accurate' });
    expect(line?.impact).toMatch(/confirms/i);
    expect(typeof line?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('logs a contradicting impact note when inaccurate feedback hits a high-confidence KPI', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    seed('high', 'T1');

    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'inaccurate' });

    const line = auditLines(logSpy).find((l) => l.event === 'feedback_received');
    expect(line?.impact).toMatch(/worth investigating/i);
    logSpy.mockRestore();
  });

  it('still logs even when the insight cannot be found', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    const line = auditLines(logSpy).find((l) => l.event === 'feedback_received');
    expect(line).toMatchObject({ outcome: 'insight_not_found' });
    logSpy.mockRestore();
  });
});

describe('getFeedbackStatus — prompts for feedback (acceptance #2)', () => {
  it('a KPI with no feedback yet appears in kpiKeysNeedingFeedback', () => {
    seed('high', 'T1');
    const status = getFeedbackStatus('T1');
    expect(status.kpiKeysNeedingFeedback).toEqual(['business.revenue.total']);
    expect(status.kpiKeysWithFeedback).toEqual([]);
  });

  it('once feedback is submitted, the key moves to kpiKeysWithFeedback', () => {
    seed('high', 'T1');
    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    const status = getFeedbackStatus('T1');
    expect(status.kpiKeysWithFeedback).toEqual(['business.revenue.total']);
    expect(status.kpiKeysNeedingFeedback).toEqual([]);
  });

  it('a generatedAt that is not the current latest returns an empty, not fabricated, status', () => {
    seed('high', 'T2');
    const status = getFeedbackStatus('T1');
    expect(status).toEqual({ generatedAt: 'T1', kpiKeysWithFeedback: [], kpiKeysNeedingFeedback: [] });
  });
});

describe('submitFeedback — version recording (STORY-014)', () => {
  it('a successful recording appends exactly one version', () => {
    seed('high', 'T1');
    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });

    expect(listVersions('business.revenue.total', 'T1')).toHaveLength(1);
  });

  it('a resubmission (updated) appends a second version, not a replacement', () => {
    seed('high', 'T1');
    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' });
    submitFeedback({ kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'inaccurate' });

    const versions = listVersions('business.revenue.total', 'T1');
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.rating)).toEqual(['accurate', 'inaccurate']);
  });

  it('insight_not_found appends no version — nothing changed, nothing to version', () => {
    seed('high', 'T1');
    submitFeedback({ kpiKey: 'not.a.real.kpi', generatedAt: 'T1', rating: 'accurate' });

    expect(listVersions('not.a.real.kpi', 'T1')).toEqual([]);
  });
});
