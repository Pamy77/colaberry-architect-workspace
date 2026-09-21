import { computeSatisfactionTrend, recordSatisfactionCheckin } from './satisfactionService';
import { clearCheckins } from './satisfactionStore';

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
  clearCheckins();
});

describe('computeSatisfactionTrend — insufficient data', () => {
  it('zero check-ins is insufficient_data, not a fabricated trend', () => {
    const trend = computeSatisfactionTrend();
    expect(trend.status).toBe('insufficient_data');
    expect(trend.totalCheckins).toBe(0);
    expect(trend.earlierAverage).toBeNull();
    expect(trend.laterAverage).toBeNull();
  });

  it('exactly one check-in is still insufficient_data — nothing to compare it against', () => {
    recordSatisfactionCheckin('great');
    expect(computeSatisfactionTrend().status).toBe('insufficient_data');
  });
});

describe('computeSatisfactionTrend — the math, proven with synthetic numbers (never real store seeding)', () => {
  it('later ratings averaging higher than earlier ones is correctly reported as increased', () => {
    recordSatisfactionCheckin('not_great'); // earlier half: score 1
    recordSatisfactionCheckin('not_great'); // earlier half: score 1
    recordSatisfactionCheckin('great'); // later half: score 3
    recordSatisfactionCheckin('great'); // later half: score 3

    const trend = computeSatisfactionTrend();
    expect(trend.status).toBe('increased');
    expect(trend.earlierAverage).toBe(1);
    expect(trend.laterAverage).toBe(3);
    expect(trend.totalCheckins).toBe(4);
  });

  it('later ratings averaging lower than earlier ones is correctly reported as decreased', () => {
    recordSatisfactionCheckin('great');
    recordSatisfactionCheckin('great');
    recordSatisfactionCheckin('not_great');
    recordSatisfactionCheckin('not_great');

    const trend = computeSatisfactionTrend();
    expect(trend.status).toBe('decreased');
  });

  it('equal averages are reported as flat, not rounded into a false increase', () => {
    recordSatisfactionCheckin('ok');
    recordSatisfactionCheckin('ok');
    recordSatisfactionCheckin('ok');
    recordSatisfactionCheckin('ok');

    const trend = computeSatisfactionTrend();
    expect(trend.status).toBe('flat');
    expect(trend.earlierAverage).toBe(trend.laterAverage);
  });

  it('an odd count splits with the extra check-in in the later half', () => {
    // 3 check-ins -> earlier = first 1, later = last 2.
    recordSatisfactionCheckin('not_great'); // earlier: [1]
    recordSatisfactionCheckin('great'); // later: [3, 3] -> avg 3
    recordSatisfactionCheckin('great');

    const trend = computeSatisfactionTrend();
    expect(trend.earlierAverage).toBe(1);
    expect(trend.laterAverage).toBe(3);
    expect(trend.status).toBe('increased');
  });
});

describe('recordSatisfactionCheckin / computeSatisfactionTrend — Trust logging', () => {
  it('logs every check-in with a rating and timestamp', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    recordSatisfactionCheckin('great');

    const line = auditLines(logSpy).find((l) => l.event === 'satisfaction_checkin');
    expect(line).toMatchObject({ rating: 'great' });
    expect(typeof line?.submittedAt).toBe('string');
    logSpy.mockRestore();
  });

  it('logs every trend computation, including insufficient_data', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    computeSatisfactionTrend();

    const line = auditLines(logSpy).find((l) => l.event === 'satisfaction_trend_computed');
    expect(line).toMatchObject({ status: 'insufficient_data', totalCheckins: 0 });
    logSpy.mockRestore();
  });
});
