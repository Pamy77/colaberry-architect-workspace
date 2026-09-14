import request from 'supertest';
import { createApp } from '../app';
import { resetSubscription, setSubscription } from '../services/subscriptionStore';

function silenceLogs(): jest.SpyInstance {
  return jest.spyOn(console, 'log').mockImplementation(() => undefined);
}

describe('POST /api/subscription/select', () => {
  beforeEach(() => {
    resetSubscription();
  });

  it('selecting the default active free plan is already_active, 200', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/subscription/select').send({ planId: 'free' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('already_active');
  });

  it('selecting a paid plan updates the account, 200, and carries a correlation id matching the header', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/subscription/select').send({ planId: 'plan_9' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('updated');
    expect(res.body.subscription.planId).toBe('plan_9');
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });

  it('an unknown plan id is 400, invalid_plan', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/subscription/select').send({ planId: 'plan_999' });

    expect(res.status).toBe(400);
    expect(res.body.outcome).toBe('invalid_plan');
  });

  it('a missing planId in the body is also 400, invalid_plan — not a crash', async () => {
    silenceLogs();
    const res = await request(createApp()).post('/api/subscription/select').send({});

    expect(res.status).toBe(400);
    expect(res.body.outcome).toBe('invalid_plan');
  });

  it('re-selecting the same active paid plan over HTTP does not charge twice (idempotent)', async () => {
    silenceLogs();
    const app = createApp();
    const first = await request(app).post('/api/subscription/select').send({ planId: 'plan_19' });
    const second = await request(app).post('/api/subscription/select').send({ planId: 'plan_19' });

    expect(first.body.outcome).toBe('updated');
    expect(second.body.outcome).toBe('already_active');
  });

  it('selecting a plan actually persists — a later select against an expired plan is charged again', async () => {
    silenceLogs();
    setSubscription({ planId: 'plan_9', selectedAt: 'T0', expiresAt: '2020-01-01T00:00:00.000Z' });

    const res = await request(createApp()).post('/api/subscription/select').send({ planId: 'plan_9' });

    expect(res.body.outcome).toBe('updated'); // expired, so this is a real renewal, not already_active
  });
});
