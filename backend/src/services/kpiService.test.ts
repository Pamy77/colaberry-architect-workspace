import type { CleaningResult } from './dataCleaningService';
import { calculateKpis, logKpiCalculation, type Kpi } from './kpiService';

function makeResult(
  headers: string[],
  rows: Record<string, string>[],
  flagged: { data: Record<string, string>; reason: string }[] = [],
): CleaningResult {
  return {
    headers,
    cleanedRows: rows.map((data, i) => ({ rowNumber: i + 2, data })),
    flaggedRows: flagged.map((f, i) => ({ rowNumber: rows.length + i + 2, data: f.data, reason: f.reason })),
    totalDataRows: rows.length + flagged.length,
  };
}

function byKey(kpis: Kpi[], key: string): Kpi | undefined {
  return kpis.find((k) => k.key === key);
}

describe('calculateKpis', () => {
  it('calculates column and derived business KPIs from complete data (happy path)', () => {
    const result = makeResult(
      ['month', 'revenue', 'expenses'],
      [
        { month: 'Jan', revenue: '1000', expenses: '600' },
        { month: 'Feb', revenue: '1200', expenses: '700' },
        { month: 'Mar', revenue: '800', expenses: '500' },
      ],
    );

    const calc = calculateKpis(result);

    expect(calc.status).toBe('ok');
    expect(calc.clarificationsNeeded).toEqual([]);
    expect(calc.summary.numericColumns).toEqual(['revenue', 'expenses']);

    expect(byKey(calc.kpis, 'business.revenue.total')?.value).toBe(3000);
    expect(byKey(calc.kpis, 'business.expenses.total')?.value).toBe(1800);
    expect(byKey(calc.kpis, 'business.profit.gross')?.value).toBe(1200);
    expect(byKey(calc.kpis, 'business.margin.gross')?.value).toBe(0.4);
    expect(byKey(calc.kpis, 'column.revenue.average')?.value).toBe(1000);

    for (const kpi of calc.kpis) {
      expect(kpi.evidenceLevel).toBe('high');
    }
  });

  it('produces unique KPI keys', () => {
    const result = makeResult(
      ['revenue', 'expenses', 'units'],
      [{ revenue: '10', expenses: '4', units: '2' }],
    );
    const keys = calculateKpis(result).kpis.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('handles a generic numeric column with no business meaning', () => {
    const result = makeResult(
      ['widget', 'qty'],
      [
        { widget: 'A', qty: '5' },
        { widget: 'B', qty: '7' },
      ],
    );

    const calc = calculateKpis(result);

    expect(calc.status).toBe('ok');
    expect(byKey(calc.kpis, 'column.qty.total')?.value).toBe(12);
    expect(byKey(calc.kpis, 'column.qty.average')?.value).toBe(6);
    expect(calc.kpis.some((k) => k.key.startsWith('business.'))).toBe(false);
  });

  // Failure path: missing data
  it('requests clarification when missing cells drop a KPI below the coverage threshold', () => {
    const result = makeResult(
      ['revenue', 'expenses'],
      [
        { revenue: '1000', expenses: '600' },
        { revenue: '1200', expenses: '700' },
      ],
      [{ data: { revenue: '', expenses: '500' }, reason: 'One or more cells are empty' }],
    );

    const calc = calculateKpis(result);

    expect(calc.status).toBe('needs_clarification');
    const lowCoverage = calc.clarificationsNeeded.find((c) => c.code === 'low_coverage');
    expect(lowCoverage?.column).toBe('revenue');
    // The KPI is still computed, but marked low-evidence rather than hidden.
    const revenueTotal = byKey(calc.kpis, 'business.revenue.total');
    expect(revenueTotal?.value).toBe(2200);
    expect(revenueTotal?.evidenceLevel).toBe('low');
    expect(revenueTotal?.basis.coverage).toBeCloseTo(2 / 3, 4);
  });

  // Failure path: data inconsistency
  it('skips non-numeric cells in a numeric column and flags the inconsistency', () => {
    const result = makeResult(
      ['revenue'],
      [{ revenue: '1000' }, { revenue: 'abc' }, { revenue: '1200' }, { revenue: '1300' }],
    );

    const calc = calculateKpis(result);

    expect(calc.status).toBe('needs_clarification');
    expect(calc.clarificationsNeeded.some((c) => c.code === 'inconsistent_column')).toBe(true);
    // 3 of 4 rows numeric -> coverage 0.75 -> 'medium', no low_coverage clarification.
    expect(calc.clarificationsNeeded.some((c) => c.code === 'low_coverage')).toBe(false);
    const total = byKey(calc.kpis, 'column.revenue.total');
    expect(total?.value).toBe(3500);
    expect(total?.evidenceLevel).toBe('medium');
  });

  // Failure path: calculation error / no data
  it('returns no_data clarification and no KPIs when there are no data rows', () => {
    const calc = calculateKpis(makeResult(['revenue', 'expenses'], []));

    expect(calc.status).toBe('needs_clarification');
    expect(calc.kpis).toEqual([]);
    expect(calc.clarificationsNeeded).toHaveLength(1);
    expect(calc.clarificationsNeeded[0].code).toBe('no_data');
  });

  it('returns no_numeric_columns clarification when every column is text', () => {
    const result = makeResult(
      ['name', 'city'],
      [
        { name: 'Ada', city: 'London' },
        { name: 'Grace', city: 'New York' },
      ],
    );

    const calc = calculateKpis(result);

    expect(calc.status).toBe('needs_clarification');
    expect(calc.kpis).toEqual([]);
    expect(calc.clarificationsNeeded[0].code).toBe('no_numeric_columns');
  });

  it('guards divide-by-zero when total revenue is zero', () => {
    const result = makeResult(
      ['revenue', 'expenses'],
      [
        { revenue: '0', expenses: '100' },
        { revenue: '0', expenses: '150' },
      ],
    );

    const calc = calculateKpis(result);

    expect(byKey(calc.kpis, 'business.profit.gross')?.value).toBe(-250);
    expect(byKey(calc.kpis, 'business.margin.gross')).toBeUndefined();
    expect(calc.clarificationsNeeded.some((c) => c.code === 'missing_kpi_inputs')).toBe(true);
  });

  it('asks for the expenses column when only revenue is present', () => {
    const result = makeResult(
      ['revenue'],
      [{ revenue: '1000' }, { revenue: '2000' }],
    );

    const calc = calculateKpis(result);

    expect(byKey(calc.kpis, 'business.revenue.total')?.value).toBe(3000);
    expect(byKey(calc.kpis, 'business.profit.gross')).toBeUndefined();
    const missing = calc.clarificationsNeeded.find((c) => c.code === 'missing_kpi_inputs');
    expect(missing?.question).toMatch(/expenses/i);
  });

  it('maps coverage to evidence level at the documented boundaries', () => {
    const high = calculateKpis(
      makeResult(['qty'], [{ qty: '1' }, { qty: '2' }, { qty: '3' }, { qty: '4' }]),
    );
    expect(byKey(high.kpis, 'column.qty.total')?.evidenceLevel).toBe('high');

    // 3 of 4 rows numeric -> coverage exactly 0.75 -> 'medium'.
    const medium = calculateKpis(
      makeResult(['qty'], [{ qty: '1' }, { qty: '2' }, { qty: '3' }, { qty: 'x' }]),
    );
    expect(byKey(medium.kpis, 'column.qty.total')?.evidenceLevel).toBe('medium');
  });

  it('normalizes currency-formatted values', () => {
    const result = makeResult(
      ['revenue', 'expenses'],
      [
        { revenue: '$1,000.50', expenses: '$400' },
        { revenue: '$2,000', expenses: '$600' },
      ],
    );

    const calc = calculateKpis(result);
    expect(byKey(calc.kpis, 'business.revenue.total')?.value).toBe(3000.5);
    expect(calc.status).toBe('ok');
  });
});

describe('logKpiCalculation', () => {
  it('writes one structured line with per-KPI evidence levels', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const calc = calculateKpis(
        makeResult(['revenue', 'expenses'], [{ revenue: '100', expenses: '40' }]),
      );
      logKpiCalculation(calc, { filename: 'sales.csv' });

      expect(spy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(spy.mock.calls[0][0] as string);
      expect(logged.event).toBe('kpi_calculation');
      expect(logged.outcome).toBe('success');
      expect(logged.context.filename).toBe('sales.csv');
      expect(Array.isArray(logged.context.evidence)).toBe(true);
      expect(logged.context.evidence[0]).toHaveProperty('evidenceLevel');
    } finally {
      spy.mockRestore();
    }
  });

  it('logs at warn/partial when clarification is needed', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      logKpiCalculation(calculateKpis(makeResult(['name'], [{ name: 'Ada' }])));
      const logged = JSON.parse(spy.mock.calls[0][0] as string);
      expect(logged.level).toBe('warn');
      expect(logged.outcome).toBe('partial');
      expect(logged.context.clarificationCodes).toContain('no_numeric_columns');
    } finally {
      spy.mockRestore();
    }
  });
});
