import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadForm } from './UploadForm';
import { UploadApiError } from '../services/uploadApi';

vi.mock('../services/uploadApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/uploadApi')>();
  return { ...actual, uploadFile: vi.fn() };
});
vi.mock('../services/uiInteractionApi', () => ({ reportInteraction: vi.fn() }));

import { uploadFile } from '../services/uploadApi';
import { reportInteraction } from '../services/uiInteractionApi';
const uploadFileMock = vi.mocked(uploadFile);
const reportInteractionMock = vi.mocked(reportInteraction);

function csvFile(): File {
  return new File(['date,revenue\n2026-01-01,100\n'], 'sales.csv', { type: 'text/csv' });
}

beforeEach(() => {
  uploadFileMock.mockReset();
  reportInteractionMock.mockReset();
});

describe('UploadForm — three steps or fewer (REQ-018)', () => {
  it('has a labeled file input and an Upload button, disabled until a file is chosen', () => {
    render(<UploadForm />);

    expect(screen.getByLabelText(/choose an excel or csv file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('completing the upload is exactly two user actions: choose a file, click Upload', async () => {
    uploadFileMock.mockResolvedValue({ status: 'accepted', filename: 'sales.csv' });
    render(<UploadForm />);

    // Action 1: choose a file.
    await userEvent.upload(screen.getByLabelText(/choose an excel or csv file/i), csvFile());
    expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled();

    // Action 2: click Upload.
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText(/uploaded/i)).toBeInTheDocument();
    expect(screen.getByText('sales.csv')).toBeInTheDocument();
  });
});

describe('UploadForm — states and callbacks', () => {
  it('calls onUploaded after a successful upload', async () => {
    uploadFileMock.mockResolvedValue({ status: 'accepted', filename: 'sales.csv' });
    const onUploaded = vi.fn();
    render(<UploadForm onUploaded={onUploaded} />);

    await userEvent.upload(screen.getByLabelText(/choose an excel or csv file/i), csvFile());
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText(/uploaded/i)).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledTimes(1);
  });

  it('shows the plain-language error message on failure, not a raw error (User dissatisfaction guard)', async () => {
    uploadFileMock.mockRejectedValue(new UploadApiError('Unsupported file type "exe".'));
    render(<UploadForm />);

    await userEvent.upload(screen.getByLabelText(/choose an excel or csv file/i), csvFile());
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unsupported file type "exe".');
  });

  it('reports upload_started and upload_completed interactions (Trust criterion)', async () => {
    uploadFileMock.mockResolvedValue({ status: 'accepted', filename: 'sales.csv' });
    render(<UploadForm />);

    await userEvent.upload(screen.getByLabelText(/choose an excel or csv file/i), csvFile());
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByText(/uploaded/i);

    expect(reportInteractionMock).toHaveBeenCalledWith('upload_started', { fileName: 'sales.csv' });
    expect(reportInteractionMock).toHaveBeenCalledWith('upload_completed', { fileName: 'sales.csv' });
  });

  it('reports upload_failed on error', async () => {
    uploadFileMock.mockRejectedValue(new UploadApiError('nope'));
    render(<UploadForm />);

    await userEvent.upload(screen.getByLabelText(/choose an excel or csv file/i), csvFile());
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByRole('alert');

    expect(reportInteractionMock).toHaveBeenCalledWith('upload_failed', { message: 'nope' });
  });
});
