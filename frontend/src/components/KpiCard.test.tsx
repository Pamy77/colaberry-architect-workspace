import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('colors the Total revenue value like the revenue trend chart', () => {
    render(<KpiCard kpi={kpi({ key: 'column.revenue.total', category: 'revenue', label: 'Total revenue', unit: 'currency', value: 2200 })} />);

    expect(screen.getByText('$2,200.00').className).toContain('kpi-card__value--revenue');
  });

  it('colors the Total expenses value like the expense trend chart', () => {
    render(<KpiCard kpi={kpi({ key: 'column.expenses.total', category: 'expenses', label: 'Total expenses', unit: 'currency', value: 1300 })} />);

    expect(screen.getByText('$1,300.00').className).toContain('kpi-card__value--expense');
  });

  it('colors Average revenue the same as Total revenue -- both echo the revenue chart', () => {
    render(<KpiCard kpi={kpi({ key: 'column.revenue.average', category: 'revenue', label: 'Average revenue', unit: 'currency', value: 1100 })} />);

    expect(screen.getByText('$1,100.00').className).toContain('kpi-card__value--revenue');
  });

  it('colors Average expenses the same as Total expenses -- both echo the expense chart', () => {
    render(<KpiCard kpi={kpi({ key: 'column.expenses.average', category: 'expenses', label: 'Average expenses', unit: 'currency', value: 650 })} />);

    expect(screen.getByText('$650.00').className).toContain('kpi-card__value--expense');
  });

  it('colors a non-negative derived business KPI (e.g. gross profit) like revenue -- healthy signal', () => {
    render(<KpiCard kpi={kpi({ key: 'business.profit.gross', label: 'Gross profit', unit: 'currency', value: 900 })} />);

    expect(screen.getByText('$900.00').className).toContain('kpi-card__value--revenue');
  });

  it('colors a negative derived business KPI (e.g. a loss) like expenses -- flags the problem', () => {
    render(<KpiCard kpi={kpi({ key: 'business.profit.gross', label: 'Gross profit', unit: 'currency', value: -250 })} />);

    expect(screen.getByText('-$250.00').className).toContain('kpi-card__value--expense');
  });

  it('leaves a non-revenue/expense, non-business KPI (e.g. an extra numeric column) neutral', () => {
    render(<KpiCard kpi={kpi({ key: 'column.qty.total', label: 'Total qty', unit: 'number', value: 12 })} />);

    const value = screen.getByText('12');
    expect(value.className).not.toContain('kpi-card__value--revenue');
    expect(value.className).not.toContain('kpi-card__value--expense');
  });
});

describe('KpiCard — feedback prompt (STORY-009 / REQ-011)', () => {
  it('shows no feedback prompt or confirmation when neither is requested (default, unaffected call sites)', () => {
    render(<KpiCard kpi={kpi()} />);
    expect(screen.queryByText(/was this insight accurate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you rated this/i)).not.toBeInTheDocument();
  });

  it('shows the prompt when needsFeedback is true (acceptance #2)', () => {
    render(<KpiCard kpi={kpi()} needsFeedback />);
    expect(screen.getByText(/was this insight accurate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accurate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inaccurate' })).toBeInTheDocument();
  });

  it('marks only the Accurate button with the accent styling class', () => {
    render(<KpiCard kpi={kpi()} needsFeedback />);

    expect(screen.getByRole('button', { name: 'Accurate' }).className).toContain('kpi-card__btn--accurate');
    expect(screen.getByRole('button', { name: 'Inaccurate' }).className).not.toContain('kpi-card__btn--accurate');
  });

  it('calls onSubmitFeedback with the chosen rating when a button is clicked', async () => {
    const onSubmitFeedback = vi.fn();
    render(<KpiCard kpi={kpi()} needsFeedback onSubmitFeedback={onSubmitFeedback} />);

    await userEvent.click(screen.getByRole('button', { name: 'Inaccurate' }));

    expect(onSubmitFeedback).toHaveBeenCalledWith('inaccurate');
  });

  it('shows a confirmation instead of the prompt once feedback already exists', () => {
    render(<KpiCard kpi={kpi()} needsFeedback={false} feedbackRating="accurate" />);

    expect(screen.getByText(/you rated this/i)).toBeInTheDocument();
    expect(screen.getByText('accurate')).toBeInTheDocument();
    expect(screen.queryByText(/was this insight accurate/i)).not.toBeInTheDocument();
  });
});

describe('KpiCard — undo (STORY-014 / REQ-010)', () => {
  it('offers Undo only when feedback already exists', () => {
    const { rerender } = render(<KpiCard kpi={kpi()} needsFeedback feedbackRating={null} />);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();

    rerender(<KpiCard kpi={kpi()} needsFeedback={false} feedbackRating="accurate" />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('calls onUndo when clicked', async () => {
    const onUndo = vi.fn();
    render(<KpiCard kpi={kpi()} needsFeedback={false} feedbackRating="accurate" onUndo={onUndo} />);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
