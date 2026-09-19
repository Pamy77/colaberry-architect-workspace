import request from 'supertest';
import { createApp } from '../app';

function auditLines(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

function silenceLogs(): jest.SpyInstance {
  return jest.spyOn(console, 'log').mockImplementation(() => undefined);
}

describe('POST /api/ui/interactions', () => {
  it('logs the event with a timestamp and correlation id (Trust criterion)', async () => {
    const logSpy = silenceLogs();

    const res = await request(createApp())
      .post('/api/ui/interactions')
      .send({ event: 'upload_started', context: { fileCount: 1 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'logged' });
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);

    const line = auditLines(logSpy).find((l) => l.event === 'ui_interaction');
    expect(line).toMatchObject({ interaction: 'upload_started', context: { fileCount: 1 } });
    expect(typeof line?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('accepts an event with no context', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/ui/interactions').send({ event: 'upload_completed' });
    expect(res.status).toBe(200);
  });

  it('a malformed body (missing event) is a 400, does not crash the endpoint', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/ui/interactions').send({});

    expect(res.status).toBe(400);
    expect(res.body.errorClass).toBe('ValidationError');
  });
});
