import { render, screen } from '@testing-library/react';
import { TrendBarChart } from './TrendBarChart';
import type { MonthlyTotal } from '../types';

const DATA: MonthlyTotal[] = [
  { month: '2026-02', revenue: 1000, expenses: 400 },
  { month: '2026-03', revenue: null, expenses: 500 }, // no usable revenue that month
  { month: '2026-04', revenue: 1500, expenses: 600 },
];

describe('TrendBarChart', () => {
  it('draws one bar per month that has a usable value for the given metric', () => {
    render(<TrendBarChart title="Revenue trend" data={DATA} metric="revenue" color="#1f7a44" />);

    // Only Feb and Apr have a non-null revenue value — March is skipped,
    // never drawn as a fabricated zero.
    expect(screen.getByText('Feb 2026')).toBeInTheDocument();
    expect(screen.getByText('Apr 2026')).toBeInTheDocument();
    expect(screen.queryByText('Mar 2026')).not.toBeInTheDocument();
  });

  it('draws a bar for every month when the metric has a value everywhere', () => {
    render(<TrendBarChart title="Expense trend" data={DATA} metric="expenses" color="#b23b3b" />);

    expect(screen.getByText('Feb 2026')).toBeInTheDocument();
    expect(screen.getByText('Mar 2026')).toBeInTheDocument();
    expect(screen.getByText('Apr 2026')).toBeInTheDocument();
  });

  it('shows an empty-state message instead of an empty chart when no month has a usable value', () => {
    const empty: MonthlyTotal[] = [{ month: '2026-02', revenue: null, expenses: null }];
    render(<TrendBarChart title="Revenue trend" data={empty} metric="revenue" color="#1f7a44" />);

    expect(screen.getByText('Not enough dated data yet to chart a trend.')).toBeInTheDocument();
  });

  it('shows the empty state when there is no monthly data at all', () => {
    render(<TrendBarChart title="Revenue trend" data={[]} metric="revenue" color="#1f7a44" />);

    expect(screen.getByText('Not enough dated data yet to chart a trend.')).toBeInTheDocument();
  });
});
