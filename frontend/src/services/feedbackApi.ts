/**
 * Client for the feedback endpoints (STORY-009 / REQ-011):
 *   GET  /api/insights/feedback-status
 *   POST /api/insights/feedback
 *
 * Same timeout + capped-retry + terminal-vs-retryable shape as
 * `kpiApi.ts`'s `fetchKpis` — a 4xx or an unrecognised body is terminal (no
 * retry, since retrying a rejected request or garbage response can't help);
 * a timeout, network error, or 5xx is retried. This is the direct guard
 * against the "User interface issues" failure path: a failed request shows
 * a clear message instead of the UI hanging or silently losing the attempt.
 */

export type FeedbackRating = 'accurate' | 'inaccurate';

export interface FeedbackStatus {
  generatedAt: string;
  kpiKeysWithFeedback: string[];
  kpiKeysNeedingFeedback: string[];
}

export interface FeedbackEntry {
  id: string;
  kpiKey: string;
  generatedAt: string;
  rating: FeedbackRating;
  comment: string | null;
  submittedAt: string;
}

export interface SubmitFeedbackResult {
  outcome: 'recorded' | 'updated' | 'insight_not_found';
  correlationId: string;
  entry?: FeedbackEntry;
}

export class FeedbackApiError extends Error {
  /** True when retrying cannot help (bad request, unknown insight, unrecognised response). */
  readonly terminal: boolean;

  constructor(message: string, options: { terminal?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'FeedbackApiError';
    this.terminal = options.terminal ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface FeedbackApiOptions {
  timeoutMs?: number;
  /** Retries AFTER the first attempt. Default 2. */
  retries?: number;
  /** Backoff before retry N is backoffMs * N. Default 400. */
  backoffMs?: number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
}

async function withRetry<T>(attempt: () => Promise<T>, options: FeedbackApiOptions, failMessage: string): Promise<T> {
  const { retries = 2, backoffMs = 400 } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let i = 0; i <= retries; i += 1) {
    if (i > 0) await sleep(backoffMs * i);
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof FeedbackApiError && err.terminal) throw err;
      lastError = err;
    }
  }
  throw new FeedbackApiError(failMessage, { cause: lastError });
}

async function withTimeout<T>(
  doFetch: typeof fetch,
  timeoutMs: number,
  run: (fetchWithSignal: typeof fetch, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(doFetch, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchFeedbackStatus(
  generatedAt: string,
  options: FeedbackApiOptions = {},
): Promise<FeedbackStatus> {
  const { timeoutMs = 8000 } = options;
  const doFetch = options.fetchImpl ?? fetch;

  return withRetry(
    () =>
      withTimeout(doFetch, timeoutMs, async (fetchImpl, signal) => {
        const res = await fetchImpl(`/api/insights/feedback-status?generatedAt=${encodeURIComponent(generatedAt)}`, {
          headers: { Accept: 'application/json' },
          signal,
        });
        if (res.status >= 400 && res.status < 500) {
          throw new FeedbackApiError(`The feedback status request was rejected (${res.status}).`, { terminal: true });
        }
        if (!res.ok) {
          throw new FeedbackApiError(`The server is having trouble (${res.status}).`);
        }
        const body = (await res.json()) as unknown;
        if (!body || typeof body !== 'object' || !('kpiKeysNeedingFeedback' in body)) {
          throw new FeedbackApiError('Received an unexpected feedback-status response.', { terminal: true });
        }
        return body as FeedbackStatus;
      }),
    options,
    'Could not check which insights need feedback. Check your connection and try again.',
  );
}

export async function submitInsightFeedback(
  params: { kpiKey: string; generatedAt: string; rating: FeedbackRating; comment?: string },
  options: FeedbackApiOptions = {},
): Promise<SubmitFeedbackResult> {
  const { timeoutMs = 8000 } = options;
  const doFetch = options.fetchImpl ?? fetch;

  return withRetry(
    () =>
      withTimeout(doFetch, timeoutMs, async (fetchImpl, signal) => {
        const res = await fetchImpl('/api/insights/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(params),
          signal,
        });
        // A 404 (insight_not_found) is still a well-formed, meaningful
        // answer from the API, not a failure to reach it — the caller
        // decides what to show, retrying it would just get the same 404.
        if (res.status === 404) {
          const body = (await res.json()) as unknown;
          if (body && typeof body === 'object' && 'outcome' in body) {
            return body as SubmitFeedbackResult;
          }
          throw new FeedbackApiError('Received an unexpected feedback response.', { terminal: true });
        }
        if (res.status >= 400 && res.status < 500) {
          throw new FeedbackApiError(`The feedback submission was rejected (${res.status}).`, { terminal: true });
        }
        if (!res.ok) {
          throw new FeedbackApiError(`The server is having trouble (${res.status}).`);
        }
        const body = (await res.json()) as unknown;
        if (!body || typeof body !== 'object' || !('outcome' in body)) {
          throw new FeedbackApiError('Received an unexpected feedback response.', { terminal: true });
        }
        return body as SubmitFeedbackResult;
      }),
    options,
    'Could not submit your feedback. Check your connection and try again.',
  );
}
