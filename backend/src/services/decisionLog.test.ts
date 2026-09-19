import { clearDecisions, listDecisions, recordDecision } from './decisionLog';

beforeEach(() => {
  clearDecisions();
});

describe('recordDecision', () => {
  it('records a decision with a generated id and timestamp', () => {
    const entry = recordDecision({
      type: 'subscription_change',
      summary: 'Subscribed to $9/month',
      context: { planId: 'plan_9' },
    });

    expect(entry.id).toBeTruthy();
    expect(entry.type).toBe('subscription_change');
    expect(entry.summary).toBe('Subscribed to $9/month');
    expect(typeof entry.occurredAt).toBe('string');
    expect(listDecisions()).toHaveLength(1);
  });

  it('each recorded decision gets its own independent id', () => {
    const a = recordDecision({ type: 'alert_approved', summary: 'a', context: {} });
    const b = recordDecision({ type: 'alert_approved', summary: 'b', context: {} });
    expect(a.id).not.toBe(b.id);
  });

  it('accepts an explicit occurredAt for tests that need deterministic ordering', () => {
    const entry = recordDecision({
      type: 'alert_rejected',
      summary: 'rejected',
      context: {},
      occurredAt: '2020-01-01T00:00:00.000Z',
    });
    expect(entry.occurredAt).toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('listDecisions', () => {
  it('returns an empty list when nothing has been recorded', () => {
    expect(listDecisions()).toEqual([]);
  });

  it('returns decisions newest first', () => {
    recordDecision({ type: 'subscription_change', summary: 'first', context: {}, occurredAt: '2020-01-01T00:00:00.000Z' });
    recordDecision({ type: 'alert_approved', summary: 'second', context: {}, occurredAt: '2020-06-01T00:00:00.000Z' });
    recordDecision({ type: 'alert_rejected', summary: 'third', context: {}, occurredAt: '2020-03-01T00:00:00.000Z' });

    expect(listDecisions().map((d) => d.summary)).toEqual(['second', 'third', 'first']);
  });
});

describe('clearDecisions', () => {
  it('resets the log to empty', () => {
    recordDecision({ type: 'subscription_change', summary: 'x', context: {} });
    clearDecisions();
    expect(listDecisions()).toEqual([]);
  });
});
