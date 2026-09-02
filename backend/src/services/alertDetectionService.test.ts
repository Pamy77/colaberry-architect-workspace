import { detectKpiAlerts, ALERT_THRESHOLD_PCT } from './alertDetectionService';
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
