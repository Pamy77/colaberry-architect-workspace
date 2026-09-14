import { createPaymentProcessor } from './paymentProcessor';

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

describe('createPaymentProcessor (dry-run, no STRIPE_API_KEY)', () => {
  const original = process.env.STRIPE_API_KEY;
  beforeEach(() => {
    delete process.env.STRIPE_API_KEY;
  });
  afterAll(() => {
    if (original !== undefined) process.env.STRIPE_API_KEY = original;
  });

  it('resolves with a receipt without ever charging anything real', async () => {
    const receipt = await createPaymentProcessor().charge('plan_9', 9);
    expect(receipt).toMatchObject({ planId: 'plan_9', amountUsd: 9 });
    expect(receipt.reference).toMatch(/^dry-run-/);
  });

  it('logs a payment_attempt line for every charge, for the Trust audit trail', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await createPaymentProcessor().charge('plan_19', 19);

    const line = auditLines(logSpy).find((l) => l.event === 'payment_attempt');
    expect(line).toMatchObject({ outcome: 'simulated', planId: 'plan_19', amountUsd: 19 });
    expect(typeof line?.timestamp).toBe('string');
    logSpy.mockRestore();
  });

  it('mode does not claim to be real', () => {
    expect(createPaymentProcessor().mode).toBe('payment:dry-run');
  });
});

describe('createPaymentProcessor (STRIPE_API_KEY present, real adapter not built)', () => {
  const original = process.env.STRIPE_API_KEY;
  beforeEach(() => {
    process.env.STRIPE_API_KEY = 'sk_test_not_actually_used';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_API_KEY;
    else process.env.STRIPE_API_KEY = original;
  });

  it('still falls back to dry-run rather than shipping an untested real path', async () => {
    const processor = createPaymentProcessor();
    expect(processor.mode).toBe('payment:dry-run(key-present)');
    const receipt = await processor.charge('free', 0);
    expect(receipt.reference).toMatch(/^dry-run-/);
  });

  it('warns that the key is unused, and never logs the key value itself', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    createPaymentProcessor();

    const lines = auditLines(logSpy);
    const warnLine = lines.find((l) => l.event === 'payment_processor_config');
    expect(warnLine).toBeDefined();
    expect(JSON.stringify(lines)).not.toContain('sk_test_not_actually_used');
    logSpy.mockRestore();
  });
});
