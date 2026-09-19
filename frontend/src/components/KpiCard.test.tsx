import { render, screen } from '@testing-library/react';
import { KpiCard } from './KpiCard';
import type { Kpi } from '../types';

/**
 * STORY-007 / REQ-009: every evidence level must actually render, not just
 * the ones already exercised elsewhere. `high` and `medium` were already
 * covered indirectly by Dashboard.test.tsx; `low` never was, anywhere.
 */

function kpi(overrides: Partial<Kpi> = {}): Kpi {
  return {
    key: 'column.qty.total',
    label: 'Total of qty',
    value: 1,
    unit: 'number',
    evidenceLevel: 'high',
    evidenceNote: '1 of 5 row(s) had a numeric value (20% coverage); 4 row(s) were empty or non-numeric.',
    basis: { column: 'qty', rowsConsidered: 5, rowsUsed: 1, coverage: 0.2 },
    ...overrides,
  };
}

describe('KpiCard', () => {
  it('renders a low-confidence KPI with its own label, modifier class, and note (REQ-009)', () => {
    render(<KpiCard kpi={kpi({ evidenceLevel: 'low' })} />);

    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByText('Low confidence').className).toContain('kpi-card__evidence--low');
    expect(screen.getByText(/20% coverage/)).toBeInTheDocument();
  });

  it('renders a medium-confidence KPI distinctly from low', () => {
    render(<KpiCard kpi={kpi({ evidenceLevel: 'medium' })} />);

    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText('Medium confidence').className).toContain('kpi-card__evidence--medium');
    expect(screen.queryByText('Low confidence')).not.toBeInTheDocument();
  });

  it('renders a high-confidence KPI distinctly from low and medium', () => {
    render(<KpiCard kpi={kpi({ evidenceLevel: 'high' })} />);

    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('High confidence').className).toContain('kpi-card__evidence--high');
  });

  it('always shows the label and formatted value alongside the evidence level', () => {
    render(<KpiCard kpi={kpi({ evidenceLevel: 'low', label: 'Total revenue', unit: 'currency', value: 250 })} />);

    expect(screen.getByText('Total revenue')).toBeInTheDocument();
    expect(screen.getByText(/\$250/)).toBeInTheDocument();
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
  });
});
