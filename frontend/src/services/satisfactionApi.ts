/**
 * Client for the satisfaction endpoints (STORY-010 / REQ-014):
 *   POST /api/satisfaction/checkin
 *   GET  /api/satisfaction/trend
 *
 * Same timeout + capped-retry + terminal-vs-retryable shape as every
 * other client in this codebase (`kpiApi.ts`, `feedbackApi.ts`,
 * `uploadApi.ts`).
 */

export type SatisfactionRating = 'great' | 'ok' | 'not_great';

export interface SatisfactionTrend {
  status: 'increased' | 'decreased' | 'flat' | 'insufficient_data';
  totalCheckins: number;
  earlierAverage: number | null;
  laterAverage: number | null;
  generatedAt: string;
  correlationId: string;
}

export class SatisfactionApiError extends Error {
  readonly terminal: boolean;

  constructor(message: string, options: { terminal?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'SatisfactionApiError';
    this.terminal = options.terminal ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface SatisfactionApiOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

async function withRetry<T>(
  attempt: () => Promise<T>,
  options: SatisfactionApiOptions,
  failMessage: string,
): Promise<T> {
  const { retries = 2, backoffMs = 400 } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let i = 0; i <= retries; i += 1) {
    if (i > 0) await sleep(backoffMs * i);
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof SatisfactionApiError && err.terminal) throw err;
      lastError = err;
    }
  }
  throw new SatisfactionApiError(failMessage, { cause: lastError });
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

export async function submitSatisfactionCheckin(
  rating: SatisfactionRating,
  options: SatisfactionApiOptions = {},
): Promise<void> {
  const { timeoutMs = 8000 } = options;
  const doFetch = options.fetchImpl ?? fetch;

  await withRetry(
    () =>
      withTimeout(doFetch, timeoutMs, async (fetchImpl, signal) => {
        const res = await fetchImpl('/api/satisfaction/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ rating }),
          signal,
        });
        if (res.status >= 400 && res.status < 500) {
          throw new SatisfactionApiError(`The check-in was rejected (${res.status}).`, { terminal: true });
        }
        if (!res.ok) {
          throw new SatisfactionApiError(`The server is having trouble (${res.status}).`);
        }
      }),
    options,
    'Could not submit your check-in. Check your connection and try again.',
  );
}

export async function fetchSatisfactionTrend(
  options: SatisfactionApiOptions = {},
): Promise<SatisfactionTrend> {
  const { timeoutMs = 8000 } = options;
  const doFetch = options.fetchImpl ?? fetch;

  return withRetry(
    () =>
      withTimeout(doFetch, timeoutMs, async (fetchImpl, signal) => {
        const res = await fetchImpl('/api/satisfaction/trend', {
          headers: { Accept: 'application/json' },
          signal,
        });
        if (res.status >= 400 && res.status < 500) {
          throw new SatisfactionApiError(`The trend request was rejected (${res.status}).`, { terminal: true });
        }
        if (!res.ok) {
          throw new SatisfactionApiError(`The server is having trouble (${res.status}).`);
        }
        const body = (await res.json()) as unknown;
        if (!body || typeof body !== 'object' || !('status' in body)) {
          throw new SatisfactionApiError('Received an unexpected trend response.', { terminal: true });
        }
        return body as SatisfactionTrend;
      }),
    options,
    'Could not load the satisfaction trend. Check your connection and try again.',
  );
}
