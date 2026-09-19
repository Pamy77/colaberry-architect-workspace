import request from 'supertest';
import { createApp } from '../app';
import { clearDecisions, recordDecision } from '../services/decisionLog';

function silenceLogs(): jest.SpyInstance {
  return jest.spyOn(console, 'log').mockImplementation(() => undefined);
}

describe('GET /api/reports/summary', () => {
  beforeEach(() => {
    clearDecisions();
  });

  it('returns no_actions when nothing has been decided yet (acceptance #2)', async () => {
    silenceLogs();
    const res = await request(createApp()).get('/api/reports/summary');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'no_actions', decisionCount: 0, decisions: [] });
  });

  it('includes every recorded decision (acceptance #1)', async () => {
    silenceLogs();
    recordDecision({ type: 'subscription_change', summary: 'Subscribed to $9/month', context: { planId: 'plan_9' } });
    recordDecision({ type: 'alert_rejected', summary: 'Rejected 1 KPI change', context: { alertId: 'a1' } });

    const res = await request(createApp()).get('/api/reports/summary');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.decisionCount).toBe(2);
    expect(res.body.decisions.map((d: { summary: string }) => d.summary)).toEqual(
      expect.arrayContaining(['Subscribed to $9/month', 'Rejected 1 KPI change']),
    );
  });

  it('carries a correlation id in the header matching the body', async () => {
    silenceLogs();
    const res = await request(createApp()).get('/api/reports/summary');

    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(res.headers['x-correlation-id']).toBe(res.body.correlationId);
  });
});
