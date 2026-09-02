import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard } from './Dashboard';
import { DashboardLoadError } from '../services/kpiApi';
import type { DashboardData } from '../types';

// Replace the network client; keep the real DashboardLoadError so the
// component's `instanceof` branch is exercised.
vi.mock('../services/kpiApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/kpiApi')>();
  return { ...actual, fetchKpis: vi.fn() };
});

import { fetchKpis } from '../services/kpiApi';
const fetchKpisMock = vi.mocked(fetchKpis);

const OK_DATA: DashboardData = {
  status: 'ok',
  generatedAt: '2026-09-02T12:00:00.000Z',
  filename: 'sales.csv',
  kpis: [
    {
      key: 'business.revenue.total',
      label: 'Total revenue',
      value: 2200,
      unit: 'currency',
      evidenceLevel: 'high',
      evidenceNote: '2 of 2 row(s) had a numeric value (100% coverage).',
      basis: { column: 'revenue', rowsConsidered: 2, rowsUsed: 2, coverage: 1 },
    },
    {
      key: 'business.margin.gross',
      label: 'Gross margin',
      value: 0.4032,
      unit: 'ratio',
      evidenceLevel: 'medium',
      evidenceNote: 'Gross profit divided by total revenue.',
      basis: { column: null, rowsConsidered: 2, rowsUsed: 2, coverage: 1 },
    },
  ],
  clarificationsNeeded: [],
  summary: { totalDataRows: 2, cleanedRowCount: 2, flaggedRowCount: 0, numericColumns: ['revenue'] },
};

beforeEach(() => {
  fetchKpisMock.mockReset();
});

describe('Dashboard', () => {
  it('renders KPI cards clearly when KPIs are available', async () => {
    fetchKpisMock.mockResolvedValue(OK_DATA);

    render(<Dashboard />);

    expect(await screen.findByText('Total revenue')).toBeInTheDocument();
    expect(screen.getByText(/2,200/)).toBeInTheDocument();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('Gross margin')).toBeInTheDocument();
    expect(screen.getByText('40.3%')).toBeInTheDocument();
    expect(screen.getByText(/sales\.csv/)).toBeInTheDocument();
  });

  it('lists clarification questions when the data is incomplete', async () => {
    fetchKpisMock.mockResolvedValue({
      ...OK_DATA,
      status: 'needs_clarification',
      clarificationsNeeded: [
        { code: 'low_coverage', question: 'Only 60% of rows have a usable value for "revenue".', column: 'revenue' },
      ],
    });

    render(<Dashboard />);

    expect(await screen.findByText(/before these numbers are final/i)).toBeInTheDocument();
    expect(screen.getByText(/only 60% of rows/i)).toBeInTheDocument();
  });

  it('shows a "no data" message when there are no KPIs', async () => {
    fetchKpisMock.mockResolvedValue({ status: 'no_data', generatedAt: null });

    render(<Dashboard />);

    expect(await screen.findByText(/no kpis yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows an error state when loading fails, and retries when the button is clicked', async () => {
    fetchKpisMock
      .mockRejectedValueOnce(
        new DashboardLoadError('The dashboard could not load your KPIs. Check your connection and try again.'),
      )
      .mockResolvedValueOnce({ status: 'no_data', generatedAt: null });

    render(<Dashboard />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your kpis/i);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText(/no kpis yet/i)).toBeInTheDocument();
    expect(fetchKpisMock).toHaveBeenCalledTimes(2);
  });
});
