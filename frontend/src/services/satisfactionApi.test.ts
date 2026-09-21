import { SatisfactionApiError, fetchSatisfactionTrend, submitSatisfactionCheckin } from './satisfactionApi';

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('submitSatisfactionCheckin', () => {
  it('posts the rating on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'recorded', id: 'c1' }));

    await submitSatisfactionCheckin('great', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/satisfaction/checkin',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ rating: 'great' }) }),
    );
  });

  it('does not retry a 4xx — it is terminal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad' }, 400));

    await expect(
      submitSatisfactionCheckin('great', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ name: 'SatisfactionApiError', terminal: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'recorded', id: 'c1' }));

    await submitSatisfactionCheckin('ok', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('fetchSatisfactionTrend', () => {
  it('returns the parsed trend on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'insufficient_data',
        totalCheckins: 0,
        earlierAverage: null,
        laterAverage: null,
        generatedAt: 'T1',
        correlationId: 'c1',
      }),
    );

    const trend = await fetchSatisfactionTrend({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });
    expect(trend.status).toBe('insufficient_data');
  });

  it('gives up after the retry cap with a friendly message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const err = await fetchSatisfactionTrend({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      retries: 1,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SatisfactionApiError);
    expect(err.message).toMatch(/could not load/i);
  });
});
