import { UploadApiError, uploadFile } from './uploadApi';

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function csvFile(): File {
  return new File(['date,revenue\n2026-01-01,100\n'], 'sales.csv', { type: 'text/csv' });
}

describe('uploadFile', () => {
  it('returns the parsed result on a 200, posting multipart form data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'accepted', filename: 'sales.csv' }));

    const result = await uploadFile(csvFile(), { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(result).toEqual({ status: 'accepted', filename: 'sales.csv' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('surfaces the server\'s own plain-language message on a 4xx, and does not retry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'error', errorClass: 'ValidationError', message: 'Unsupported file type "exe".' }, 400));

    await expect(
      uploadFile(csvFile(), { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ name: 'UploadApiError', terminal: true, message: 'Unsupported file type "exe".' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx and succeeds on a later attempt (safe: uploadRoute dedupes by content hash)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'boom' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'accepted', filename: 'sales.csv' }));

    const result = await uploadFile(csvFile(), { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep });

    expect(result.status).toBe('accepted');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry cap with a friendly message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));

    const err = await uploadFile(csvFile(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      retries: 1,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(UploadApiError);
    expect(err.message).toMatch(/could not upload/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats an unrecognised body as terminal', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ weird: true }));

    await expect(
      uploadFile(csvFile(), { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep }),
    ).rejects.toMatchObject({ terminal: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
