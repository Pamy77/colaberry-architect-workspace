import type { DashboardData } from '../types';

/**
 * Client for GET /api/kpis (STORY-003).
 *
 * Every call has an explicit timeout (AbortController) and capped retries with
 * backoff, per the project build rules. A 4xx or an unrecognised body is
 * terminal (no retry); a timeout, a network error, or a 5xx is retried.
 * When every attempt fails, a `DashboardLoadError` with a user-facing message
 * is thrown so the dashboard can show its error state ("Dashboard fails to
 * load").
 */

export class DashboardLoadError extends Error {
  /** True when retrying cannot help (bad request, unrecognised response). */
  readonly terminal: boolean;

  constructor(message: string, options: { terminal?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'DashboardLoadError';
    this.terminal = options.terminal ?? false;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface FetchKpisOptions {
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

const ENDPOINT = '/api/kpis';

export async function fetchKpis(options: FetchKpisOptions = {}): Promise<DashboardData> {
  const { timeoutMs = 8000, retries = 2, backoffMs = 400 } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoffMs * attempt);
    try {
      return await attemptFetch(doFetch, timeoutMs);
    } catch (err) {
      if (err instanceof DashboardLoadError && err.terminal) throw err;
      lastError = err;
    }
  }

  throw new DashboardLoadError(
    'The dashboard could not load your KPIs. Check your connection and try again.',
    { cause: lastError },
  );
}

async function attemptFetch(doFetch: typeof fetch, timeoutMs: number): Promise<DashboardData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (res.status >= 400 && res.status < 500) {
      throw new DashboardLoadError(`The dashboard request was rejected (${res.status}).`, {
        terminal: true,
      });
    }
    if (!res.ok) {
      throw new DashboardLoadError(`The server is having trouble (${res.status}).`);
    }

    return parseDashboardData(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

function parseDashboardData(body: unknown): DashboardData {
  if (!body || typeof body !== 'object' || !('status' in body)) {
    throw new DashboardLoadError('The dashboard received an unexpected response.', {
      terminal: true,
    });
  }
  const status = (body as { status: unknown }).status;
  if (status === 'no_data') {
    return { status: 'no_data', generatedAt: null };
  }
  if (status === 'ok' || status === 'needs_clarification') {
    return body as DashboardData;
  }
  throw new DashboardLoadError('The dashboard received an unrecognised response.', {
    terminal: true,
  });
}
