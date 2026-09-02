import {
  buildStepEntry,
  checkIdempotency,
  deriveIdempotencyKey,
  newRun,
  RecentRuns,
  rememberRun,
  runStep,
  terminalWhenNamed,
  TimeoutError,
  type StepLogEntry,
} from './processingAudit';

/** Capture the structured JSON lines runStep writes to stdout. */
function captureAuditLines(): { lines: () => StepLogEntry[]; restore: () => void } {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  return {
    lines: () =>
      spy.mock.calls
        .map((call) => {
          try {
            return JSON.parse(call[0] as string) as StepLogEntry;
          } catch {
            return null;
          }
        })
        .filter((l): l is StepLogEntry => l !== null && l.event === 'processing_step'),
    restore: () => spy.mockRestore(),
  };
}

const noopSleep = (): Promise<void> => Promise.resolve();

describe('newRun', () => {
  it('mints a unique runId per run and adopts an explicit one when given', () => {
    expect(newRun().runId).not.toBe(newRun().runId);
    expect(newRun('corr-123').runId).toBe('corr-123');
    expect(newRun().seq).toBe(0);
  });
});

describe('runStep — happy path', () => {
  it('runs fn once, returns its value, and logs started + succeeded with one step_id', async () => {
    const audit = captureAuditLines();
    try {
      const run = newRun('corr-happy');
      let calls = 0;

      const result = await runStep(run, 'clean', () => {
        calls += 1;
        return { rows: 3 };
      });

      expect(result).toEqual({ rows: 3 });
      expect(calls).toBe(1);

      const lines = audit.lines();
      expect(lines.map((l) => l.status)).toEqual(['started', 'succeeded']);
      for (const line of lines) {
        expect(line.correlation_id).toBe('corr-happy');
        expect(line.step).toBe('clean');
        expect(line.step_id).toBe('corr-happy-s1');
        expect(typeof line.timestamp).toBe('string');
        expect(line.status).toBeDefined();
      }
      expect(lines[1].duration_ms).toBeGreaterThanOrEqual(0);
      expect(lines[1].outcome).toBe('success');
    } finally {
      audit.restore();
    }
  });
});

describe('runStep — unique identifier and status per step', () => {
  it('gives each step in a run its own step_id and step_seq', async () => {
    const audit = captureAuditLines();
    try {
      const run = newRun('corr-multi');
      await runStep(run, 'parse', () => 'a');
      await runStep(run, 'clean', () => 'b');
      await runStep(run, 'kpi', () => 'c');

      const starts = audit.lines().filter((l) => l.status === 'started');
      expect(starts.map((l) => l.step_id)).toEqual([
        'corr-multi-s1',
        'corr-multi-s2',
        'corr-multi-s3',
      ]);
      expect(starts.map((l) => l.step_seq)).toEqual([1, 2, 3]);
      expect(starts.every((l) => typeof l.status === 'string')).toBe(true);
    } finally {
      audit.restore();
    }
  });
});

describe('runStep — retry without duplicating data', () => {
  it('retries a transient failure and calls fn exactly once per attempt', async () => {
    const audit = captureAuditLines();
    try {
      const run = newRun('corr-retry');
      const sleeps: number[] = [];
      let calls = 0;

      const result = await runStep(
        run,
        'clean',
        (attempt) => {
          calls += 1;
          if (attempt < 3) throw new Error('transient upstream blip');
          return 'ok';
        },
        {
          backoffMs: 50,
          sleep: (ms) => {
            sleeps.push(ms);
            return Promise.resolve();
          },
        },
      );

      expect(result).toBe('ok');
      // Two failed attempts + one success — fn ran exactly three times, never more.
      expect(calls).toBe(3);
      expect(sleeps).toEqual([50, 100]); // exponential backoff: 50 * 2^0, 50 * 2^1

      const statuses = audit.lines().map((l) => l.status);
      expect(statuses).toEqual([
        'started',
        'failed',
        'retrying',
        'failed',
        'retrying',
        'succeeded',
      ]);
      expect(audit.lines().every((l) => l.step_id === 'corr-retry-s1')).toBe(true);
    } finally {
      audit.restore();
    }
  });

  it('stops after the retry cap and rethrows the original error as gave_up', async () => {
    const audit = captureAuditLines();
    try {
      const run = newRun('corr-cap');
      let calls = 0;

      await expect(
        runStep(
          run,
          'clean',
          () => {
            calls += 1;
            throw new Error('still failing');
          },
          { retries: 2, sleep: noopSleep },
        ),
      ).rejects.toThrow('still failing');

      expect(calls).toBe(3); // first attempt + 2 retries, then it gives up
      const lines = audit.lines();
      expect(lines.map((l) => l.status)).toEqual([
        'started',
        'failed',
        'retrying',
        'failed',
        'retrying',
        'failed',
        'gave_up',
      ]);
      const terminal = lines[lines.length - 1];
      expect(terminal.status).toBe('gave_up');
      expect(terminal.error_class).toBe('Error');
      expect(terminal.level).toBe('error');
    } finally {
      audit.restore();
    }
  });
});

describe('runStep — terminal (non-retryable) errors', () => {
  it('does not retry an error named as terminal', async () => {
    const audit = captureAuditLines();
    try {
      const run = newRun('corr-terminal');
      let calls = 0;

      class ParseError extends Error {
        constructor() {
          super('bad file');
          this.name = 'ParseError';
        }
      }

      await expect(
        runStep(
          run,
          'parse',
          () => {
            calls += 1;
            throw new ParseError();
          },
          { retries: 2, isRetryable: terminalWhenNamed('ParseError'), sleep: noopSleep },
        ),
      ).rejects.toThrow('bad file');

      expect(calls).toBe(1); // deterministic failure — retrying would just fail again
      expect(audit.lines().map((l) => l.status)).toEqual(['started', 'failed', 'gave_up']);
    } finally {
      audit.restore();
    }
  });
});

describe('runStep — per-attempt timeout', () => {
  it('fails a step whose fn does not resolve within timeoutMs', async () => {
    const audit = captureAuditLines();
    try {
      const run = newRun('corr-timeout');

      await expect(
        runStep(run, 'slow', () => new Promise<never>(() => undefined), {
          timeoutMs: 10,
          retries: 0,
        }),
      ).rejects.toBeInstanceOf(TimeoutError);

      const lines = audit.lines();
      expect(lines.map((l) => l.status)).toEqual(['started', 'failed', 'gave_up']);
      expect(lines[lines.length - 1].error_class).toBe('TimeoutError');
    } finally {
      audit.restore();
    }
  });
});

describe('deriveIdempotencyKey', () => {
  it('is stable for the same bytes + filename and changes when either changes', () => {
    const a = deriveIdempotencyKey(Buffer.from('date,revenue\nJan,100\n'), 'sales.csv');
    const same = deriveIdempotencyKey(Buffer.from('date,revenue\nJan,100\n'), 'sales.csv');
    const otherName = deriveIdempotencyKey(Buffer.from('date,revenue\nJan,100\n'), 'sales2.csv');
    const otherBytes = deriveIdempotencyKey(Buffer.from('date,revenue\nJan,101\n'), 'sales.csv');

    expect(a).toBe(same);
    expect(a).not.toBe(otherName);
    expect(a).not.toBe(otherBytes);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('RecentRuns', () => {
  it('remembers a run and returns undefined for an unknown key', () => {
    const runs = new RecentRuns<string>(4);
    runs.remember('k1', { runId: 'r1', result: 'v1' });

    expect(runs.get('k1')).toEqual({ runId: 'r1', result: 'v1' });
    expect(runs.get('missing')).toBeUndefined();
  });

  it('evicts the oldest entry once it is full (bounded memory)', () => {
    const runs = new RecentRuns<string>(2);
    runs.remember('k1', { runId: 'r1', result: 'v1' });
    runs.remember('k2', { runId: 'r2', result: 'v2' });
    runs.remember('k3', { runId: 'r3', result: 'v3' });

    expect(runs.size).toBe(2);
    expect(runs.get('k1')).toBeUndefined(); // oldest, dropped
    expect(runs.get('k2')).toBeDefined();
    expect(runs.get('k3')).toBeDefined();
  });

  it('re-remembering a key refreshes it so it is not the next one evicted', () => {
    const runs = new RecentRuns<string>(2);
    runs.remember('k1', { runId: 'r1', result: 'v1' });
    runs.remember('k2', { runId: 'r2', result: 'v2' });
    runs.remember('k1', { runId: 'r1b', result: 'v1b' }); // k1 becomes newest
    runs.remember('k3', { runId: 'r3', result: 'v3' }); // evicts k2, not k1

    expect(runs.get('k1')).toEqual({ runId: 'r1b', result: 'v1b' });
    expect(runs.get('k2')).toBeUndefined();
  });

  it('clamps a non-positive capacity to 1', () => {
    const runs = new RecentRuns<string>(0);
    runs.remember('k1', { runId: 'r1', result: 'v1' });
    runs.remember('k2', { runId: 'r2', result: 'v2' });
    expect(runs.size).toBe(1);
  });
});

describe('checkIdempotency', () => {
  it('miss: logs idempotency_check started + succeeded and reports not-duplicate', () => {
    const audit = captureAuditLines();
    try {
      const run = newRun('corr-miss');
      const registry = new RecentRuns<{ n: number }>();

      const decision = checkIdempotency(run, registry, 'key-abc');

      expect(decision).toEqual({ key: 'key-abc', duplicate: false });
      expect(run.seq).toBe(1);
      const lines = audit.lines();
      expect(lines.map((l) => l.status)).toEqual(['started', 'succeeded']);
      expect(lines.every((l) => l.step === 'idempotency_check')).toBe(true);
      expect(lines.every((l) => l.step_id === 'corr-miss-s1')).toBe(true);
      expect(lines[0].context).toMatchObject({ idempotencyKey: 'key-abc' });
    } finally {
      audit.restore();
    }
  });

  it('hit: logs a duplicate terminal line and returns the prior run result', () => {
    const audit = captureAuditLines();
    try {
      const registry = new RecentRuns<{ n: number }>();
      rememberRun(registry, 'key-dup', newRun('corr-original'), { n: 42 });

      const run = newRun('corr-resubmit');
      const decision = checkIdempotency(run, registry, 'key-dup');

      expect(decision).toMatchObject({
        key: 'key-dup',
        duplicate: true,
        priorResult: { n: 42 },
        priorRunId: 'corr-original',
      });

      const lines = audit.lines();
      expect(lines.map((l) => l.status)).toEqual(['started', 'duplicate']);
      const terminal = lines[1];
      expect(terminal.level).toBe('warn');
      expect(terminal.outcome).toBe('success');
      expect(terminal.context).toMatchObject({
        idempotencyKey: 'key-dup',
        originalRunId: 'corr-original',
      });
    } finally {
      audit.restore();
    }
  });

  it('end to end: a second run with the same key is recognised as a duplicate', () => {
    const audit = captureAuditLines();
    try {
      const registry = new RecentRuns<string>();
      const key = deriveIdempotencyKey(Buffer.from('a,b\n1,2\n'), 'f.csv');

      const first = newRun();
      expect(checkIdempotency(first, registry, key).duplicate).toBe(false);
      rememberRun(registry, key, first, 'the-result');

      const second = newRun();
      const decision = checkIdempotency(second, registry, key);
      expect(decision.duplicate).toBe(true);
      expect(decision.priorResult).toBe('the-result');
      expect(decision.priorRunId).toBe(first.runId);
    } finally {
      audit.restore();
    }
  });
});

describe('buildStepEntry', () => {
  it('is pure and produces a fully-formed audit line without console I/O', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const run = newRun('corr-pure');
      const entry = buildStepEntry({
        run,
        step: 'clean',
        stepId: 'corr-pure-s1',
        stepSeq: 1,
        attempt: 1,
        status: 'succeeded',
        durationMs: 12,
        context: { filename: 'sales.csv' },
      });

      expect(logSpy).not.toHaveBeenCalled();
      expect(entry).toMatchObject({
        service: 'backend',
        event: 'processing_step',
        correlation_id: 'corr-pure',
        step_id: 'corr-pure-s1',
        status: 'succeeded',
        outcome: 'success',
        duration_ms: 12,
        context: { filename: 'sales.csv' },
      });
      expect(typeof entry.timestamp).toBe('string');
    } finally {
      logSpy.mockRestore();
    }
  });
});
