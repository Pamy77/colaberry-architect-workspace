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

// Same reason: without this, Dashboard's real fetchFeedbackStatus call
// hits an unmocked relative URL in every test and retries with real
// backoff timers that outlive the test (STORY-009).
vi.mock('../services/feedbackApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/feedbackApi')>();
  return { ...actual, fetchFeedbackStatus: vi.fn(), submitInsightFeedback: vi.fn() };
});

import { fetchKpis } from '../services/kpiApi';
import { FeedbackApiError, fetchFeedbackStatus, submitInsightFeedback } from '../services/feedbackApi';
const fetchKpisMock = vi.mocked(fetchKpis);
const fetchFeedbackStatusMock = vi.mocked(fetchFeedbackStatus);
const submitInsightFeedbackMock = vi.mocked(submitInsightFeedback);

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
  fetchFeedbackStatusMock.mockReset();
  submitInsightFeedbackMock.mockReset();
  // Default: nothing needs feedback, so existing tests that don't care
  // about STORY-009 behave exactly as before it existed.
  fetchFeedbackStatusMock.mockResolvedValue({
    generatedAt: OK_DATA.generatedAt as string,
    kpiKeysWithFeedback: [],
    kpiKeysNeedingFeedback: [],
  });
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

  it('shows the evidence level on a low-confidence KPI alongside higher-confidence ones (STORY-007 / REQ-009)', async () => {
    fetchKpisMock.mockResolvedValue({
      ...OK_DATA,
      status: 'needs_clarification',
      kpis: [
        ...OK_DATA.kpis,
        {
          key: 'column.qty.total',
          label: 'Total of qty',
          value: 1,
          unit: 'number',
          evidenceLevel: 'low',
          evidenceNote: '1 of 5 row(s) had a numeric value (20% coverage); 4 row(s) were empty or non-numeric.',
          basis: { column: 'qty', rowsConsidered: 5, rowsUsed: 1, coverage: 0.2 },
        },
      ],
      clarificationsNeeded: [
        { code: 'low_coverage', question: 'Only 20% of rows have a usable value for "qty".', column: 'qty' },
      ],
    });

    render(<Dashboard />);

    // All three levels visible together on one page — the acceptance
    // criterion's literal case (a low-confidence KPI, when displayed).
    expect(await screen.findByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByText('Total of qty')).toBeInTheDocument();
    expect(screen.getByText(/only 20% of rows/i)).toBeInTheDocument();
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

describe('Dashboard — feedback prompts (STORY-009 / REQ-011)', () => {
  it('prompts for feedback on a KPI the status fetch names as needing it (acceptance #2)', async () => {
    fetchKpisMock.mockResolvedValue(OK_DATA);
    fetchFeedbackStatusMock.mockResolvedValue({
      generatedAt: OK_DATA.generatedAt as string,
      kpiKeysWithFeedback: [],
      kpiKeysNeedingFeedback: ['business.revenue.total'],
    });

    render(<Dashboard />);

    expect(await screen.findByText(/was this insight accurate/i)).toBeInTheDocument();
    // The other KPI on the same page, not named as needing feedback, gets no prompt.
    const cards = screen.getAllByRole('article');
    const marginCard = cards.find((c) => c.getAttribute('aria-label') === 'Gross margin');
    expect(marginCard).toBeDefined();
    expect(marginCard!.textContent).not.toMatch(/was this insight accurate/i);
  });

  it('submitting feedback removes the prompt and shows the given rating', async () => {
    fetchKpisMock.mockResolvedValue(OK_DATA);
    fetchFeedbackStatusMock.mockResolvedValue({
      generatedAt: OK_DATA.generatedAt as string,
      kpiKeysWithFeedback: [],
      kpiKeysNeedingFeedback: ['business.revenue.total'],
    });
    submitInsightFeedbackMock.mockResolvedValue({ outcome: 'recorded', correlationId: 'c1' });

    render(<Dashboard />);
    await screen.findByText(/was this insight accurate/i);

    await userEvent.click(screen.getByRole('button', { name: 'Accurate' }));

    expect(await screen.findByText(/you rated this/i)).toBeInTheDocument();
    expect(screen.queryByText(/was this insight accurate/i)).not.toBeInTheDocument();
    expect(submitInsightFeedbackMock).toHaveBeenCalledWith({
      kpiKey: 'business.revenue.total',
      generatedAt: OK_DATA.generatedAt,
      rating: 'accurate',
    });
  });

  it('a failed feedback submission shows a friendly error without crashing the page (User interface issues)', async () => {
    fetchKpisMock.mockResolvedValue(OK_DATA);
    fetchFeedbackStatusMock.mockResolvedValue({
      generatedAt: OK_DATA.generatedAt as string,
      kpiKeysWithFeedback: [],
      kpiKeysNeedingFeedback: ['business.revenue.total'],
    });
    submitInsightFeedbackMock.mockRejectedValue(
      new FeedbackApiError('Could not submit your feedback. Check your connection and try again.'),
    );

    render(<Dashboard />);
    await screen.findByText(/was this insight accurate/i);
    await userEvent.click(screen.getByRole('button', { name: 'Accurate' }));

    expect(await screen.findByText(/could not submit your feedback/i)).toBeInTheDocument();
    // The rest of the page is still intact — not replaced by an error screen.
    expect(screen.getByText('Total revenue')).toBeInTheDocument();
  });

  it('a failed feedback-status fetch does not block the main dashboard from rendering', async () => {
    fetchKpisMock.mockResolvedValue(OK_DATA);
    fetchFeedbackStatusMock.mockRejectedValue(new Error('status check failed'));

    render(<Dashboard />);

    expect(await screen.findByText('Total revenue')).toBeInTheDocument();
    expect(screen.queryByText(/was this insight accurate/i)).not.toBeInTheDocument();
  });
});
