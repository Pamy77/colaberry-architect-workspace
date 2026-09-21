/**
 * Shape of the dashboard data returned by the backend's GET /api/kpis
 * (see backend/src/routes/dashboardContract.ts). The backend validates this
 * with Zod at its boundary; here it is the TypeScript view of the same
 * contract.
 */

export type EvidenceLevel = 'high' | 'medium' | 'low';
export type KpiUnit = 'currency' | 'ratio' | 'number';

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit: KpiUnit;
  evidenceLevel: EvidenceLevel;
  evidenceNote: string;
  basis: {
    column: string | null;
    rowsConsidered: number;
    rowsUsed: number;
    coverage: number;
  };
  /** Set on the revenue/expense column KPIs so the dashboard can group them. */
  category?: 'revenue' | 'expenses';
}

export interface Clarification {
  code: string;
  question: string;
  column: string | null;
}

export interface MonthlyTotal {
  month: string;
  revenue: number | null;
  expenses: number | null;
}

export interface KpiSummary {
  totalDataRows: number;
  cleanedRowCount: number;
  flaggedRowCount: number;
  numericColumns: string[];
  dateRange: { start: string; end: string } | null;
  monthlySeries: MonthlyTotal[];
}

export type DashboardData =
  | { status: 'no_data'; generatedAt: null }
  | {
      status: 'ok' | 'needs_clarification';
      generatedAt: string;
      filename: string;
      kpis: Kpi[];
      clarificationsNeeded: Clarification[];
      summary: KpiSummary;
    };
