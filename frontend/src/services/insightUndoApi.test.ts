import { InsightUndoApiError, undoInsightFeedback } from './insightUndoApi';

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('undoInsightFeedback', () => {
  it('posts kpiKey and generatedAt, returns the parsed result', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ outcome: 'restored', restoredRating: 'accurate', correlationId: 'c1' }));

    const result = await undoInsightFeedback('business.revenue.total', 'T1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.outcome).toBe('restored');
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/insights/undo',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kpiKey: 'business.revenue.total', generatedAt: 'T1' }),
      }),
    );
  });

  it('treats irreversible as a real, well-formed answer, not an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ outcome: 'irreversible', correlationId: 'c1' }));

    const result = await undoInsightFeedback('k', 'T1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.outcome).toBe('irreversible');
  });

  it('does not retry a 4xx — it is terminal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad' }, 400));

    await expect(
      undoInsightFeedback('k', 'T1', { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ name: 'InsightUndoApiError', terminal: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ outcome: 'restored', correlationId: 'c1' }));

    const result = await undoInsightFeedback('k', 'T1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(result.outcome).toBe('restored');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry cap with a friendly message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const err = await undoInsightFeedback('k', 'T1', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      retries: 1,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(InsightUndoApiError);
    expect(err.message).toMatch(/could not undo/i);
  });
});
