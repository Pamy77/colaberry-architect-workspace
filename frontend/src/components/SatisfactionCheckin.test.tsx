import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SatisfactionCheckin } from './SatisfactionCheckin';
import { SatisfactionApiError } from '../services/satisfactionApi';

vi.mock('../services/satisfactionApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/satisfactionApi')>();
  return { ...actual, submitSatisfactionCheckin: vi.fn() };
});

import { submitSatisfactionCheckin } from '../services/satisfactionApi';
const submitMock = vi.mocked(submitSatisfactionCheckin);

beforeEach(() => {
  submitMock.mockReset();
});

describe('SatisfactionCheckin', () => {
  it('renders three plain-language options', () => {
    render(<SatisfactionCheckin />);
    expect(screen.getByRole('button', { name: '🙂 Great' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /not great/i })).toBeInTheDocument();
  });

  it('clicking an option submits the corresponding rating', async () => {
    submitMock.mockResolvedValue(undefined);
    render(<SatisfactionCheckin />);

    await userEvent.click(screen.getByRole('button', { name: /not great/i }));

    expect(submitMock).toHaveBeenCalledWith('not_great');
    expect(await screen.findByText(/thanks for letting us know/i)).toBeInTheDocument();
  });

  it('shows a plain-language error on failure, not a raw error', async () => {
    submitMock.mockRejectedValue(new SatisfactionApiError('nope'));
    render(<SatisfactionCheckin />);

    await userEvent.click(screen.getByRole('button', { name: '🙂 Great' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('nope');
  });
});
