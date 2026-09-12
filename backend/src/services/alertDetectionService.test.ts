import fs from 'fs';
import path from 'path';
import { detectKpiAlerts, ALERT_THRESHOLD_PCT } from './alertDetectionService';
import type { CleaningResult } from './dataCleaningService';
import { cleanFile } from './dataCleaningService';
import { calculateKpis } from './kpiService';
import type { Kpi } from './kpiService';

function kpi(overrides: Partial<Kpi> & Pick<Kpi, 'key' | 'value'>): Kpi {
  return {
    label: overrides.key,
    unit: 'number',
    evidenceLevel: 'high',
    evidenceNote: '',
    basis: { column: null, rowsConsidered: 0, rowsUsed: 0, coverage: 0 },
    ...overrides,
  };
}

describe('detectKpiAlerts', () => {
  it('flags a change at or above the threshold', () => {
    const prev = [kpi({ key: 'business.revenue.total', label: 'Total revenue', value: 18000 })];
    const cur = [kpi({ key: 'business.revenue.total', label: 'Total revenue', value: 22090 })];

    const alerts = detectKpiAlerts(prev, cur, { thresholdPct: 15 });

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      key: 'business.revenue.total',
      previousValue: 18000,
      currentValue: 22090,
      absoluteChange: 4090,
      percentChange: 22.7,
      direction: 'increase',
      thresholdPct: 15,
    });
    expect(alerts[0].reason).toBe('Total revenue rose 22.7% (18000 → 22090)');
  });

  it('ignores a change below the threshold', () => {
    const prev = [kpi({ key: 'k', value: 18000 })];
    const cur = [kpi({ key: 'k', value: 19000 })]; // +5.6%

    expect(detectKpiAlerts(prev, cur, { thresholdPct: 15 })).toEqual([]);
  });

  it('treats a change exactly at the threshold as significant', () => {
    const alerts = detectKpiAlerts(
      [kpi({ key: 'k', value: 100 })],
      [kpi({ key: 'k', value: 115 })],
      { thresholdPct: 15 },
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].percentChange).toBe(15);
  });

  it('flags a decrease and describes it as a fall', () => {
    const alerts = detectKpiAlerts(
      [kpi({ key: 'business.margin.gross', label: 'Gross margin', unit: 'ratio', value: 0.42 })],
      [kpi({ key: 'business.margin.gross', label: 'Gross margin', unit: 'ratio', value: 0.29 })],
      { thresholdPct: 15 },
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe('decrease');
    expect(alerts[0].reason).toMatch(/^Gross margin fell 31%/);
  });

  it('does not alert when a KPI is unchanged', () => {
    expect(
      detectKpiAlerts([kpi({ key: 'k', value: 500 })], [kpi({ key: 'k', value: 500 })]),
    ).toEqual([]);
  });

  it('does not alert on a brand-new KPI (no baseline)', () => {
    expect(detectKpiAlerts([], [kpi({ key: 'k', value: 999 })])).toEqual([]);
  });

  it('does not alert on a KPI that disappeared', () => {
    expect(detectKpiAlerts([kpi({ key: 'k', value: 999 })], [])).toEqual([]);
  });

  it('treats any move away from a zero baseline as significant, with a null percent', () => {
    const alerts = detectKpiAlerts(
      [kpi({ key: 'adoption', label: 'Feature adoption', value: 0 })],
      [kpi({ key: 'adoption', label: 'Feature adoption', value: 15 })],
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].percentChange).toBeNull();
    expect(alerts[0].direction).toBe('increase');
    expect(alerts[0].reason).toBe('Feature adoption rose from zero (0 → 15)');
  });

  it('carries the weaker evidence level of the two readings', () => {
    const alerts = detectKpiAlerts(
      [kpi({ key: 'k', value: 100, evidenceLevel: 'high' })],
      [kpi({ key: 'k', value: 130, evidenceLevel: 'low' })],
    );
    expect(alerts[0].evidenceLevel).toBe('low');
  });

  it('returns one alert per significant KPI, in current-list order', () => {
    const prev = [kpi({ key: 'a', value: 100 }), kpi({ key: 'b', value: 100 }), kpi({ key: 'c', value: 100 })];
    const cur = [kpi({ key: 'a', value: 200 }), kpi({ key: 'b', value: 101 }), kpi({ key: 'c', value: 50 })];

    const alerts = detectKpiAlerts(prev, cur, { thresholdPct: 15 });

    expect(alerts.map((a) => a.key)).toEqual(['a', 'c']); // b is only +1%
  });

  it('defaults the threshold to ALERT_THRESHOLD_PCT (15)', () => {
    expect(ALERT_THRESHOLD_PCT).toBe(15);
    // +10% is below the default -> no alert when no override is passed.
    expect(detectKpiAlerts([kpi({ key: 'k', value: 100 })], [kpi({ key: 'k', value: 110 })])).toEqual([]);
    // +20% clears it.
    expect(
      detectKpiAlerts([kpi({ key: 'k', value: 100 })], [kpi({ key: 'k', value: 120 })]),
    ).toHaveLength(1);
  });

  it('reads ALERT_THRESHOLD_PCT from the environment at load time', () => {
    jest.isolateModules(() => {
      const prevEnv = process.env.ALERT_THRESHOLD_PCT;
      process.env.ALERT_THRESHOLD_PCT = '30';
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./alertDetectionService') as typeof import('./alertDetectionService');
        expect(mod.ALERT_THRESHOLD_PCT).toBe(30);
        expect(mod.detectKpiAlerts([{ ...base('k', 100) }], [{ ...base('k', 125) }])).toEqual([]); // +25% < 30
      } finally {
        if (prevEnv === undefined) delete process.env.ALERT_THRESHOLD_PCT;
        else process.env.ALERT_THRESHOLD_PCT = prevEnv;
      }
    });
  });
});

// Walking-skeleton stage 3 (alert-insight-agent): proves the negative case for
// the stage-2 sales-trend KPI (business.revenue.trend.momAvg) — a real
// stage-2 value that either doesn't cross ALERT_THRESHOLD_PCT, or simply isn't
// present because stage 2 asked for clarification instead of fabricating one,
// must never produce an alert for that key. Complements the positive
// end-to-end case in notificationService.test.ts.
describe('business.revenue.trend.momAvg — no fabricated alert on sub-threshold or missing data', () => {
  it('does not alert when the real trend KPI moves but stays under the threshold', async () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'sampleSales.csv');
    const buffer = fs.readFileSync(fixturePath);
    const cleaned = await cleanFile(buffer, 'sampleSales.csv');
    const calc = calculateKpis(cleaned);

    const currentTrend = calc.kpis.find((k) => k.key === 'business.revenue.trend.momAvg');
    expect(currentTrend).toBeDefined();
    expect(currentTrend?.value).toBeCloseTo(0.2349, 4); // real stage-2 output, not hand-typed

    // Previous reading close enough that the move is ~6.8%, under the default
    // 15% threshold -- this is a real move, just not a significant one.
    const previousTrend = kpi({
      key: 'business.revenue.trend.momAvg',
      label: currentTrend!.label,
      value: 0.22,
      unit: 'ratio',
    });

    const alerts = detectKpiAlerts([previousTrend], calc.kpis);
    expect(alerts.find((a) => a.key === 'business.revenue.trend.momAvg')).toBeUndefined();
  });

  it('does not fabricate an alert when the current side has no trend KPI (insufficient_trend_data instead)', () => {
    // Only one month of data -- stage 2's own documented behavior is to
    // request clarification (`insufficient_trend_data`) rather than emit a
    // KPI. There is nothing here to verify or alert on.
    const singleMonthResult: CleaningResult = {
      headers: ['date', 'revenue'],
      cleanedRows: [
        { rowNumber: 2, data: { date: '2026-01-05', revenue: '1000' } },
        { rowNumber: 3, data: { date: '2026-01-12', revenue: '1200' } },
      ],
      flaggedRows: [],
      totalDataRows: 2,
    };

    const calc = calculateKpis(singleMonthResult);
    expect(calc.status).toBe('needs_clarification');
    expect(calc.clarificationsNeeded.some((c) => c.code === 'insufficient_trend_data')).toBe(true);
    expect(calc.kpis.find((k) => k.key === 'business.revenue.trend.momAvg')).toBeUndefined();

    const previousTrend = kpi({
      key: 'business.revenue.trend.momAvg',
      label: 'Sales trend (avg. month-over-month revenue change)',
      value: 0.1,
      unit: 'ratio',
    });

    // current (calc.kpis) has no entry for the trend key at all -> the
    // detector's own "no baseline / no counterpart" rule means nothing is
    // emitted for it, regardless of how large `previousTrend`'s value is.
    const alerts = detectKpiAlerts([previousTrend], calc.kpis);
    expect(alerts.find((a) => a.key === 'business.revenue.trend.momAvg')).toBeUndefined();
  });
});

function base(key: string, value: number): Kpi {
  return {
    key,
    label: key,
    value,
    unit: 'number',
    evidenceLevel: 'high',
    evidenceNote: '',
    basis: { column: null, rowsConsidered: 0, rowsUsed: 0, coverage: 0 },
  };
}
