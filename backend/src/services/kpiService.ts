import type { CleaningResult } from './dataCleaningService';

/**
 * KPI calculation (STORY-002 / REQ-003).
 *
 * Pure, total, and independent of HTTP — mirrors `dataCleaningService.ts`:
 * it takes a `CleaningResult` and returns a `KpiCalculation`. It never throws
 * for data-shaped problems; instead it reports what it could compute plus a
 * list of `clarificationsNeeded` so the caller can ask the user rather than
 * present a silently-wrong number.
 */

export type EvidenceLevel = 'high' | 'medium' | 'low';

export type KpiUnit = 'currency' | 'ratio' | 'number';

export interface KpiBasis {
  /** Source column, or null for a KPI derived from other KPIs. */
  column: string | null;
  /** Non-empty data rows the KPI was measured against (cleaned + flagged). */
  rowsConsidered: number;
  /** Of those, how many carried a parseable numeric value for this KPI. */
  rowsUsed: number;
  /** rowsUsed / rowsConsidered, 0 when rowsConsidered is 0. */
  coverage: number;
}

export interface Kpi {
  /** Stable machine key, unique within a result (e.g. "business.revenue.total"). */
  key: string;
  label: string;
  value: number;
  unit: KpiUnit;
  evidenceLevel: EvidenceLevel;
  evidenceNote: string;
  basis: KpiBasis;
}

export type ClarificationCode =
  | 'no_data'
  | 'no_numeric_columns'
  | 'low_coverage'
  | 'inconsistent_column'
  | 'missing_kpi_inputs'
  // A trend needs at least two data points to compare; "low_coverage" is about
  // a column's missing cells and doesn't fit "there simply aren't enough
  // distinct periods yet" (e.g. a single month of history, or no
  // calendar-adjacent months at all). REQ-008 / STORY-007: don't force-fit an
  // existing code onto a genuinely different failure mode.
  | 'insufficient_trend_data';

export interface Clarification {
  code: ClarificationCode;
  question: string;
  column: string | null;
}

export interface KpiCalculation {
  status: 'ok' | 'needs_clarification';
  kpis: Kpi[];
  clarificationsNeeded: Clarification[];
  summary: {
    totalDataRows: number;
    cleanedRowCount: number;
    flaggedRowCount: number;
    numericColumns: string[];
  };
}

// Coverage thresholds mapping a column's numeric-value share to an evidence
// level, and deciding when the result asks for clarification. Env-configurable,
// never hardcoded past these defaults (mirrors UPLOAD_MAX_* in uploadContract).
export const KPI_HIGH_EVIDENCE_MIN = envRatio('KPI_HIGH_EVIDENCE_MIN', 0.99);
export const KPI_MEDIUM_EVIDENCE_MIN = envRatio('KPI_MEDIUM_EVIDENCE_MIN', 0.75);

function envRatio(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

const REVENUE_SYNONYMS = ['revenue', 'sales', 'income', 'turnover'];
const EXPENSE_SYNONYMS = ['expenses', 'expense', 'costs', 'cost', 'spend', 'expenditure'];
const DATE_SYNONYMS = ['date', 'month', 'period'];

// Matches a leading ISO-ish "YYYY-MM" prefix (e.g. "2026-02-16" or "2026-02").
// Anything else (blank, "Feb 2026", Excel serial dates, etc.) is treated as
// unparseable rather than guessed at — a documented limitation, same spirit
// as parseNumeric's currency-format limitation above.
const MONTH_PREFIX_RE = /^(\d{4})-(\d{2})/;

interface ColumnStats {
  header: string;
  numeric: number[];
  nonNumericCount: number;
  emptyCount: number;
}

// Small-business spreadsheets commonly format money as "$1,200.50". Strip a
// leading currency symbol and thousands separators before parsing. Not handled
// (documented limitation): accounting "(100)" negatives, trailing "%", and
// non-US decimal separators — those cells count as non-numeric.
function parseNumeric(raw: string): number | null {
  const cleaned = raw.trim().replace(/^[$€£]\s?/, '').replace(/,/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function roundTo(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function evidenceFor(coverage: number): EvidenceLevel {
  if (coverage >= KPI_HIGH_EVIDENCE_MIN) return 'high';
  if (coverage >= KPI_MEDIUM_EVIDENCE_MIN) return 'medium';
  return 'low';
}

const EVIDENCE_ORDER: EvidenceLevel[] = ['low', 'medium', 'high'];
function weakest(a: EvidenceLevel, b: EvidenceLevel): EvidenceLevel {
  return EVIDENCE_ORDER.indexOf(a) <= EVIDENCE_ORDER.indexOf(b) ? a : b;
}

function collectColumnStats(result: CleaningResult): ColumnStats[] {
  const allRows = [...result.cleanedRows, ...result.flaggedRows];
  return result.headers
    .filter((header) => header !== '')
    .map((header) => {
      const stats: ColumnStats = { header, numeric: [], nonNumericCount: 0, emptyCount: 0 };
      for (const row of allRows) {
        const cell = (row.data[header] ?? '').trim();
        if (cell === '') {
          stats.emptyCount += 1;
          continue;
        }
        const parsed = parseNumeric(cell);
        if (parsed === null) stats.nonNumericCount += 1;
        else stats.numeric.push(parsed);
      }
      return stats;
    });
}

function findBySynonym(stats: ColumnStats[], synonyms: string[]): ColumnStats | undefined {
  return stats.find((s) => {
    const normalized = normalizeHeader(s.header);
    return synonyms.some((syn) => normalized === syn || normalized.includes(syn));
  });
}

function coverageKpi(
  col: ColumnStats,
  consideredRows: number,
  key: string,
  label: string,
  unit: KpiUnit,
  value: number,
): Kpi {
  const rowsUsed = col.numeric.length;
  const coverage = consideredRows === 0 ? 0 : rowsUsed / consideredRows;
  const missing = consideredRows - rowsUsed;
  const evidenceNote =
    missing === 0
      ? `${rowsUsed} of ${consideredRows} row(s) had a numeric value (${pct(coverage)} coverage).`
      : `${rowsUsed} of ${consideredRows} row(s) had a numeric value (${pct(coverage)} coverage); ${missing} row(s) were empty or non-numeric.`;
  return {
    key,
    label,
    value: roundTo(value),
    unit,
    evidenceLevel: evidenceFor(coverage),
    evidenceNote,
    basis: { column: col.header, rowsConsidered: consideredRows, rowsUsed, coverage: roundTo(coverage) },
  };
}

function addColumnKpis(
  kpis: Kpi[],
  clarifications: Clarification[],
  col: ColumnStats,
  consideredRows: number,
): void {
  const rowsUsed = col.numeric.length;
  const coverage = rowsUsed / consideredRows;

  kpis.push(
    coverageKpi(col, consideredRows, `column.${col.header}.total`, `Total of ${col.header}`, 'number', sum(col.numeric)),
  );
  kpis.push(
    coverageKpi(
      col,
      consideredRows,
      `column.${col.header}.average`,
      `Average of ${col.header}`,
      'number',
      sum(col.numeric) / rowsUsed,
    ),
  );

  if (col.nonNumericCount > 0) {
    clarifications.push({
      code: 'inconsistent_column',
      question: `Column "${col.header}" mixes numeric and non-numeric values (${col.nonNumericCount} non-numeric cell(s)). Those cells were skipped - confirm they should not count, or fix them and re-upload.`,
      column: col.header,
    });
  }
  if (coverage < KPI_MEDIUM_EVIDENCE_MIN) {
    clarifications.push({
      code: 'low_coverage',
      question: `Only ${pct(coverage)} of rows have a usable value for "${col.header}". Should the missing rows be treated as zero, or left out of the "${col.header}" KPIs?`,
      column: col.header,
    });
  }
}

function addDerivedBusinessKpis(
  kpis: Kpi[],
  clarifications: Clarification[],
  numericStats: ColumnStats[],
  consideredRows: number,
): void {
  const revenueCol = findBySynonym(numericStats, REVENUE_SYNONYMS);
  if (!revenueCol) return;

  const revenue = coverageKpi(
    revenueCol,
    consideredRows,
    'business.revenue.total',
    'Total revenue',
    'currency',
    sum(revenueCol.numeric),
  );
  kpis.push(revenue);

  const expenseCol = findBySynonym(numericStats, EXPENSE_SYNONYMS);
  if (!expenseCol) {
    clarifications.push({
      code: 'missing_kpi_inputs',
      question: `Found a revenue column ("${revenueCol.header}") but no expenses column, so gross profit and margin can't be calculated. Which column holds expenses?`,
      column: null,
    });
    return;
  }

  const expenses = coverageKpi(
    expenseCol,
    consideredRows,
    'business.expenses.total',
    'Total expenses',
    'currency',
    sum(expenseCol.numeric),
  );
  kpis.push(expenses);

  const profitValue = roundTo(revenue.value - expenses.value);
  const derivedEvidence = weakest(revenue.evidenceLevel, expenses.evidenceLevel);
  const derivedBasis: KpiBasis = {
    column: null,
    rowsConsidered: consideredRows,
    rowsUsed: Math.min(revenue.basis.rowsUsed, expenses.basis.rowsUsed),
    coverage: roundTo(Math.min(revenue.basis.coverage, expenses.basis.coverage)),
  };

  kpis.push({
    key: 'business.profit.gross',
    label: 'Gross profit',
    value: profitValue,
    unit: 'currency',
    evidenceLevel: derivedEvidence,
    evidenceNote: `Total revenue (${revenue.value}) minus total expenses (${expenses.value}).`,
    basis: derivedBasis,
  });

  if (revenue.value === 0) {
    clarifications.push({
      code: 'missing_kpi_inputs',
      question: `Gross margin can't be calculated because total revenue is zero. Confirm "${revenueCol.header}" is the right column.`,
      column: revenueCol.header,
    });
    return;
  }

  kpis.push({
    key: 'business.margin.gross',
    label: 'Gross margin',
    value: roundTo(profitValue / revenue.value),
    unit: 'ratio',
    evidenceLevel: derivedEvidence,
    evidenceNote: `Gross profit (${profitValue}) divided by total revenue (${revenue.value}).`,
    basis: derivedBasis,
  });
}

function findHeaderBySynonym(headers: string[], synonyms: string[]): string | undefined {
  return headers.find((header) => {
    const normalized = normalizeHeader(header);
    return synonyms.some((syn) => normalized === syn || normalized.includes(syn));
  });
}

function monthKeyOf(rawDate: string): string | null {
  const match = MONTH_PREFIX_RE.exec(rawDate.trim());
  return match ? `${match[1]}-${match[2]}` : null;
}

function nextMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

// Bounded defensively: months come from real observed dates in one dataset,
// but a corrupt/absurd date (e.g. year 9999) must not spin this into an
// effectively unbounded loop.
function monthRange(min: string, max: string): string[] {
  const months: string[] = [];
  let cur = min;
  for (let i = 0; i < 10_000 && cur <= max; i++) {
    months.push(cur);
    cur = nextMonthKey(cur);
  }
  return months;
}

interface MonthlyRevenueRow {
  month: string;
  revenue: number | null;
}

function collectMonthlyRevenueRows(
  result: CleaningResult,
  dateHeader: string,
  revenueHeader: string,
): MonthlyRevenueRow[] {
  const allRows = [...result.cleanedRows, ...result.flaggedRows];
  const rows: MonthlyRevenueRow[] = [];
  for (const row of allRows) {
    const month = monthKeyOf(row.data[dateHeader] ?? '');
    if (month === null) continue; // unparseable/blank date -> can't attribute to a month
    const rawRevenue = (row.data[revenueHeader] ?? '').trim();
    rows.push({ month, revenue: rawRevenue === '' ? null : parseNumeric(rawRevenue) });
  }
  return rows;
}

// Monthly sales-trend KPI (REQ-003 / REQ-009 / STORY-007): average
// month-over-month % change in the revenue column, grouped by the year-month
// prefix of the date column. Confidence is the weakest of two independent
// signals per this file's existing evidenceFor()/weakest() pattern:
//   1. coverage of the revenue column itself (missing/non-numeric cells), and
//   2. whether the calendar range has a gap (a month with zero rows at all).
// A month whose only rows are flagged/blank contributes no total (never a
// fabricated 0), and a transition is only computed between calendar-adjacent
// months, so it never overstates confidence by papering over gaps.
function addSalesTrendKpi(
  kpis: Kpi[],
  clarifications: Clarification[],
  result: CleaningResult,
  revenueCol: ColumnStats,
  consideredRows: number,
): void {
  // No date-like column, or one whose values don't parse to a recognizable
  // YYYY-MM-DD date, means this dataset simply isn't shaped for a trend —
  // mirrors this file's existing "no revenue column -> nothing to compute,
  // no clarification" precedent (see the caller) rather than treating every
  // date-less dataset as an error. The genuinely reportable case — a real
  // date column with too little history to compare — is handled below.
  const dateHeader = findHeaderBySynonym(result.headers, DATE_SYNONYMS);
  if (!dateHeader) return;

  const monthlyRows = collectMonthlyRevenueRows(result, dateHeader, revenueCol.header);
  const monthsPresent = Array.from(new Set(monthlyRows.map((r) => r.month))).sort();

  if (monthsPresent.length === 0) return;

  const totalsByMonth = new Map<string, number>();
  const numericCountByMonth = new Map<string, number>();
  for (const { month, revenue } of monthlyRows) {
    if (revenue === null) continue;
    totalsByMonth.set(month, (totalsByMonth.get(month) ?? 0) + revenue);
    numericCountByMonth.set(month, (numericCountByMonth.get(month) ?? 0) + 1);
  }
  const usableMonths = monthsPresent.filter((m) => totalsByMonth.has(m));

  if (usableMonths.length < 2) {
    clarifications.push({
      code: 'insufficient_trend_data',
      question: `Only ${usableMonths.length} month(s) of usable "${revenueCol.header}" data were found (need at least 2) so a month-over-month sales trend can't be calculated.`,
      column: revenueCol.header,
    });
    return;
  }

  const changes: number[] = [];
  for (let i = 1; i < usableMonths.length; i++) {
    const prevMonth = usableMonths[i - 1];
    const curMonth = usableMonths[i];
    if (nextMonthKey(prevMonth) !== curMonth) continue; // gap -> don't fabricate a MoM figure across it
    const prevTotal = totalsByMonth.get(prevMonth) as number;
    const curTotal = totalsByMonth.get(curMonth) as number;
    if (prevTotal === 0) continue; // divide-by-zero guard
    changes.push((curTotal - prevTotal) / prevTotal);
  }

  if (changes.length === 0) {
    clarifications.push({
      code: 'insufficient_trend_data',
      question: `"${revenueCol.header}" data doesn't contain two calendar-adjacent months with a nonzero total, so a month-over-month sales trend can't be calculated.`,
      column: revenueCol.header,
    });
    return;
  }

  const avgChange = roundTo(sum(changes) / changes.length);

  const rowsUsed = usableMonths.reduce((acc, m) => acc + (numericCountByMonth.get(m) ?? 0), 0);
  const coverage = consideredRows === 0 ? 0 : rowsUsed / consideredRows;
  const revenueEvidence = evidenceFor(coverage);

  const expectedMonths = monthRange(monthsPresent[0], monthsPresent[monthsPresent.length - 1]);
  const monthCoverage = expectedMonths.length === 0 ? 0 : monthsPresent.length / expectedMonths.length;
  const monthEvidence = evidenceFor(monthCoverage);

  const evidenceLevel = weakest(revenueEvidence, monthEvidence);
  const missingMonths = expectedMonths.filter((m) => !monthsPresent.includes(m));

  const evidenceNote =
    `Average month-over-month change across ${changes.length} calendar-adjacent transition(s) spanning ` +
    `${usableMonths.join(', ')} (${pct(coverage)} of rows had a usable "${revenueCol.header}" value)` +
    (missingMonths.length > 0 ? `; missing month(s) in range: ${missingMonths.join(', ')}.` : '.');

  kpis.push({
    key: 'business.revenue.trend.momAvg',
    label: 'Sales trend (avg. month-over-month revenue change)',
    value: avgChange,
    unit: 'ratio',
    evidenceLevel,
    evidenceNote,
    basis: {
      column: revenueCol.header,
      rowsConsidered: consideredRows,
      rowsUsed,
      coverage: roundTo(coverage),
    },
  });

  if (missingMonths.length > 0) {
    clarifications.push({
      code: 'low_coverage',
      question: `The date range spans ${monthsPresent[0]} to ${monthsPresent[monthsPresent.length - 1]} but has no rows for: ${missingMonths.join(', ')}. Confirm there's genuinely no data for those months.`,
      column: dateHeader,
    });
  }
}

export function calculateKpis(result: CleaningResult): KpiCalculation {
  const cleanedRowCount = result.cleanedRows.length;
  const flaggedRowCount = result.flaggedRows.length;
  const consideredRows = cleanedRowCount + flaggedRowCount;

  const summaryBase = {
    totalDataRows: result.totalDataRows,
    cleanedRowCount,
    flaggedRowCount,
    numericColumns: [] as string[],
  };

  if (consideredRows === 0) {
    return {
      status: 'needs_clarification',
      kpis: [],
      clarificationsNeeded: [
        {
          code: 'no_data',
          question:
            'No usable data rows were found after cleaning. Upload a file with at least one populated data row so KPIs can be calculated.',
          column: null,
        },
      ],
      summary: summaryBase,
    };
  }

  const stats = collectColumnStats(result);
  const numericStats = stats.filter((s) => s.numeric.length > 0);

  if (numericStats.length === 0) {
    const names = stats.map((s) => `"${s.header}"`).join(', ') || '(none)';
    return {
      status: 'needs_clarification',
      kpis: [],
      clarificationsNeeded: [
        {
          code: 'no_numeric_columns',
          question: `None of the columns (${names}) contain numeric values, so no KPI can be calculated. Which column holds the metric you want measured?`,
          column: null,
        },
      ],
      summary: summaryBase,
    };
  }

  const kpis: Kpi[] = [];
  const clarifications: Clarification[] = [];

  for (const col of numericStats) {
    addColumnKpis(kpis, clarifications, col, consideredRows);
  }
  addDerivedBusinessKpis(kpis, clarifications, numericStats, consideredRows);

  // Trend needs its own revenue-column lookup (not just the total/margin
  // path above) because it also needs the raw per-row date cells, which
  // addDerivedBusinessKpis doesn't carry. Mirrors that function's existing
  // "no revenue column -> nothing to do, no clarification" behavior.
  const revenueColForTrend = findBySynonym(numericStats, REVENUE_SYNONYMS);
  if (revenueColForTrend) {
    addSalesTrendKpi(kpis, clarifications, result, revenueColForTrend, consideredRows);
  }

  return {
    status: clarifications.length > 0 ? 'needs_clarification' : 'ok',
    kpis,
    clarificationsNeeded: clarifications,
    summary: { ...summaryBase, numericColumns: numericStats.map((s) => s.header) },
  };
}

/**
 * Audit line for a KPI calculation (STORY-002 acceptance: "the system logs KPI
 * calculations and evidence levels"). Structured JSON to stdout, same shape as
 * the upload/cleaning audit lines. Called from the route in the wiring step.
 */
export function logKpiCalculation(calc: KpiCalculation, context: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: calc.status === 'ok' ? 'info' : 'warn',
      service: 'backend',
      event: 'kpi_calculation',
      outcome: calc.status === 'ok' ? 'success' : 'partial',
      context: {
        ...context,
        status: calc.status,
        kpiCount: calc.kpis.length,
        clarificationCount: calc.clarificationsNeeded.length,
        evidence: calc.kpis.map((k) => ({ key: k.key, evidenceLevel: k.evidenceLevel })),
        clarificationCodes: calc.clarificationsNeeded.map((c) => c.code),
      },
    }),
  );
}
