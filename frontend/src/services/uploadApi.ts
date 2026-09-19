/**
 * Client for POST /api/upload (STORY-010's upload form; the endpoint
 * itself is STORY-001/006/011). Same timeout + capped-retry + terminal-
 * vs-retryable shape as `kpiApi.ts`/`feedbackApi.ts`. Retrying is safe
 * here specifically because `uploadRoute.ts` already dedupes by content
 * hash (STORY-011's trust spine) — a retried upload cannot double-create
 * data, so this is not an exception to the idempotency rule, it relies on
 * it.
 */

export interface UploadResult {
  status: 'accepted';
  filename: string;
}

export class UploadApiError extends Error {
  /** True when retrying cannot help (bad file, rejected by the server, unrecognised response). */
  readonly terminal: boolean;

  constructor(message: string, options: { terminal?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'UploadApiError';
    this.terminal = options.terminal ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface UploadApiOptions {
  timeoutMs?: number;
  /** Retries AFTER the first attempt. Default 1 — an upload retry is a heavier operation than a read, so this stays modest. */
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function uploadFile(file: File, options: UploadApiOptions = {}): Promise<UploadResult> {
  const { timeoutMs = 15000, retries = 1, backoffMs = 500 } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * attempt);
    try {
      return await attemptUpload(doFetch, file, timeoutMs);
    } catch (err) {
      if (err instanceof UploadApiError && err.terminal) throw err;
      lastError = err;
    }
  }

  throw new UploadApiError('Could not upload your file. Check your connection and try again.', {
    cause: lastError,
  });
}

async function attemptUpload(doFetch: typeof fetch, file: File, timeoutMs: number): Promise<UploadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const formData = new FormData();
    formData.append('file', file);

    const res = await doFetch('/api/upload', {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => null)) as unknown;

    if (res.status >= 400 && res.status < 500) {
      // uploadRoute.ts already writes a plain-language message
      // ("Unsupported file type...", "Your subscription has expired...");
      // surface it directly rather than a generic wrapper.
      const message =
        body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string'
          ? (body as { message: string }).message
          : `The upload was rejected (${res.status}).`;
      throw new UploadApiError(message, { terminal: true });
    }
    if (!res.ok) {
      throw new UploadApiError(`The server is having trouble (${res.status}).`);
    }
    if (!body || typeof body !== 'object' || (body as { status?: unknown }).status !== 'accepted') {
      throw new UploadApiError('Received an unexpected upload response.', { terminal: true });
    }

    return body as UploadResult;
  } finally {
    clearTimeout(timer);
  }
}
