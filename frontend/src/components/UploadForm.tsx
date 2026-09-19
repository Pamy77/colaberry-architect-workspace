import { useRef, useState, type ChangeEvent } from 'react';
import { uploadFile, UploadApiError } from '../services/uploadApi';
import { reportInteraction } from '../services/uiInteractionApi';

/**
 * The upload screen (STORY-010 / REQ-018: three steps or fewer).
 *
 * Exactly two user actions to a result: choose a file, click Upload. No
 * separate confirmation step, no navigation to a different screen — this
 * form lives inline on the dashboard (see `directives/12-ui-simplicity.md`
 * for why: adding a router to get "simpler" would defeat the point).
 */

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'success'; filename: string }
  | { phase: 'error'; message: string };

export interface UploadFormProps {
  /** Called after a successful upload so the caller can refresh its data. */
  onUploaded?: () => void;
}

export function UploadForm({ onUploaded }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>): void {
    setFile(e.target.files?.[0] ?? null);
    setState({ phase: 'idle' });
  }

  async function handleUpload(): Promise<void> {
    if (!file) return;
    setState({ phase: 'uploading' });
    reportInteraction('upload_started', { fileName: file.name });
    try {
      const result = await uploadFile(file);
      setState({ phase: 'success', filename: result.filename });
      reportInteraction('upload_completed', { fileName: result.filename });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.();
    } catch (err) {
      const message =
        err instanceof UploadApiError ? err.message : 'Something went wrong uploading your file.';
      setState({ phase: 'error', message });
      reportInteraction('upload_failed', { message });
    }
  }

  return (
    <section className="upload-form" aria-label="Upload your data">
      <h2>Upload your data</h2>
      <div className="upload-form__controls">
        <label htmlFor="upload-file-input">Choose an Excel or CSV file</label>
        <input
          id="upload-file-input"
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileChange}
          disabled={state.phase === 'uploading'}
        />
        <button type="button" onClick={() => void handleUpload()} disabled={!file || state.phase === 'uploading'}>
          {state.phase === 'uploading' ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {state.phase === 'success' && (
        <p className="upload-form__success" role="status">
          Uploaded <strong>{state.filename}</strong>.
        </p>
      )}

      {state.phase === 'error' && (
        <div className="upload-form__error" role="alert">
          <p>{state.message}</p>
        </div>
      )}
    </section>
  );
}
