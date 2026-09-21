import request from 'supertest';
import { createApp } from '../app';
import { clearCheckins } from '../services/satisfactionStore';

function silenceLogs(): jest.SpyInstance {
  return jest.spyOn(console, 'log').mockImplementation(() => undefined);
}

describe('POST /api/satisfaction/checkin', () => {
  beforeEach(() => {
    clearCheckins();
  });

  it('records a valid rating, 200', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/satisfaction/checkin').send({ rating: 'great' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('recorded');
    expect(res.body.id).toBeTruthy();
  });

  it('an invalid rating is a 400, not silently accepted', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/satisfaction/checkin').send({ rating: 'amazing' });

    expect(res.status).toBe(400);
    expect(res.body.errorClass).toBe('ValidationError');
  });

  it('a missing rating is a 400', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/satisfaction/checkin').send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/satisfaction/trend', () => {
  beforeEach(() => {
    clearCheckins();
  });

  it('starts at insufficient_data with nothing recorded — never a fabricated trend', async () => {
    silenceLogs();
    const res = await request(createApp()).get('/api/satisfaction/trend');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('insufficient_data');
    expect(res.body.totalCheckins).toBe(0);
  });

  it('reflects real recorded check-ins', async () => {
    silenceLogs();
    const app = createApp();
    await request(app).post('/api/satisfaction/checkin').send({ rating: 'not_great' });
    await request(app).post('/api/satisfaction/checkin').send({ rating: 'great' });

    const res = await request(app).get('/api/satisfaction/trend');
    expect(res.body.status).toBe('increased');
    expect(res.body.totalCheckins).toBe(2);
  });

  it('carries a correlation id in the header matching the body', async () => {
    silenceLogs();
    const res = await request(createApp()).get('/api/satisfaction/trend');
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });
});
