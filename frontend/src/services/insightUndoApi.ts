/**
 * Client for POST /api/insights/undo (STORY-014 / REQ-010). Same timeout
 * + capped-retry + terminal-vs-retryable shape as every other client in
 * this codebase.
 */

export type UndoOutcome = 'restored' | 'irreversible';

export interface UndoResult {
  outcome: UndoOutcome;
  restoredRating?: 'accurate' | 'inaccurate';
  restoredComment?: string | null;
  correlationId: string;
}

export class InsightUndoApiError extends Error {
  readonly terminal: boolean;

  constructor(message: string, options: { terminal?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'InsightUndoApiError';
    this.terminal = options.terminal ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface InsightUndoApiOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function undoInsightFeedback(
  kpiKey: string,
  generatedAt: string,
  options: InsightUndoApiOptions = {},
): Promise<UndoResult> {
  const { timeoutMs = 8000, retries = 2, backoffMs = 400 } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * attempt);
    try {
      return await attemptUndo(doFetch, kpiKey, generatedAt, timeoutMs);
    } catch (err) {
      if (err instanceof InsightUndoApiError && err.terminal) throw err;
      lastError = err;
    }
  }

  throw new InsightUndoApiError('Could not undo. Check your connection and try again.', { cause: lastError });
}

async function attemptUndo(
  doFetch: typeof fetch,
  kpiKey: string,
  generatedAt: string,
  timeoutMs: number,
): Promise<UndoResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch('/api/insights/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ kpiKey, generatedAt }),
      signal: controller.signal,
    });

    if (res.status >= 400 && res.status < 500) {
      throw new InsightUndoApiError(`The undo was rejected (${res.status}).`, { terminal: true });
    }
    if (!res.ok) {
      throw new InsightUndoApiError(`The server is having trouble (${res.status}).`);
    }
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== 'object' || !('outcome' in body)) {
      throw new InsightUndoApiError('Received an unexpected undo response.', { terminal: true });
    }
    return body as UndoResult;
  } finally {
    clearTimeout(timer);
  }
}
