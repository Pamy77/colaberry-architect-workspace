import { reportInteraction } from './uiInteractionApi';

describe('reportInteraction', () => {
  it('posts the event and context to /api/ui/interactions', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    reportInteraction('upload_started', { fileCount: 1 });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/ui/interactions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ event: 'upload_started', context: { fileCount: 1 } }),
      }),
    );
    fetchSpy.mockRestore();
  });

  it('never throws or rejects when the request fails (fire-and-forget)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));

    expect(() => reportInteraction('upload_failed')).not.toThrow();
    // Let the swallowed rejection settle so it doesn't leak into another test.
    await new Promise((r) => setTimeout(r, 0));

    fetchSpy.mockRestore();
  });
});
