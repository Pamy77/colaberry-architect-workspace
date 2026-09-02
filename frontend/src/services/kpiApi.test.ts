import { DashboardLoadError, fetchKpis } from './kpiApi';

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchKpis', () => {
  it('returns the parsed body on a 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'no_data', generatedAt: null }));

    const data = await fetchKpis({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(data).toEqual({ status: 'no_data', generatedAt: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/kpis', expect.objectContaining({ headers: { Accept: 'application/json' } }));
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', generatedAt: '2026-09-02T00:00:00Z', filename: 'f.csv', kpis: [], clarificationsNeeded: [], summary: { totalDataRows: 0, cleanedRowCount: 0, flaggedRowCount: 0, numericColumns: [] } }));

    const data = await fetchKpis({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(data.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx — it is terminal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'nope' }, 404));

    await expect(
      fetchKpis({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ name: 'DashboardLoadError', terminal: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry cap with a friendly message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const err = await fetchKpis({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      retries: 2,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(DashboardLoadError);
    expect(err.message).toMatch(/could not load your kpis/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // first attempt + 2 retries
  });

  it('aborts a slow request after timeoutMs and reports it', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );

    await expect(
      fetchKpis({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
        timeoutMs: 5,
        retries: 0,
      }),
    ).rejects.toMatchObject({ name: 'DashboardLoadError' });
  });

  it('treats an unrecognised body as terminal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'weird' }));

    await expect(
      fetchKpis({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ terminal: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
