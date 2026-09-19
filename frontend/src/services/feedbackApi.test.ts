import { FeedbackApiError, fetchFeedbackStatus, submitInsightFeedback } from './feedbackApi';

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('fetchFeedbackStatus', () => {
  it('returns the parsed status on a 200', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ generatedAt: 'T1', kpiKeysWithFeedback: [], kpiKeysNeedingFeedback: ['a'] }));

    const status = await fetchFeedbackStatus('T1', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(status.kpiKeysNeedingFeedback).toEqual(['a']);
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/insights/feedback-status?generatedAt=T1',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ generatedAt: 'T1', kpiKeysWithFeedback: [], kpiKeysNeedingFeedback: [] }));

    const status = await fetchFeedbackStatus('T1', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(status.generatedAt).toBe('T1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx — it is terminal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'nope' }, 400));

    await expect(
      fetchFeedbackStatus('T1', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ name: 'FeedbackApiError', terminal: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry cap with a friendly message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const err = await fetchFeedbackStatus('T1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      retries: 2,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(FeedbackApiError);
    expect(err.message).toMatch(/could not check/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('submitInsightFeedback', () => {
  const params = { kpiKey: 'business.revenue.total', generatedAt: 'T1', rating: 'accurate' as const };

  it('posts the feedback and returns the parsed result on a 200', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ outcome: 'recorded', correlationId: 'c1' }));

    const result = await submitInsightFeedback(params, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(result.outcome).toBe('recorded');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/insights/feedback',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(params) }),
    );
  });

  it('treats a 404 insight_not_found as a real, terminal answer, not a network failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ outcome: 'insight_not_found', correlationId: 'c1' }, 404));

    const result = await submitInsightFeedback(params, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(result.outcome).toBe('insight_not_found');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // never retried
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ outcome: 'recorded', correlationId: 'c1' }));

    const result = await submitInsightFeedback(params, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(result.outcome).toBe('recorded');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 — it is terminal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad request' }, 400));

    await expect(
      submitInsightFeedback(params, { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ terminal: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry cap with a friendly message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const err = await submitInsightFeedback(params, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      retries: 1,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(FeedbackApiError);
    expect(err.message).toMatch(/could not submit/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
