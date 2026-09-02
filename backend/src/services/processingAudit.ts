import { createHash, randomUUID } from 'crypto';

/**
 * Trust spine for data processing (STORY-011 / REQ-017).
 *
 * A processing "run" is one pass of the pipeline for one upload. Every step in
 * that run gets:
 *   - a unique identifier (`step_id`) and an explicit `status`
 *   - a timestamped `started` line and a timestamped terminal line
 *     (`succeeded` or `gave_up`), both carrying the run's `correlation_id`
 *   - capped, exponentially-backed-off retries for transient failures
 *
 * The retry guarantee is "retry without duplicating data": `runStep` only ever
 * re-invokes `fn`, so a step is safe to retry exactly as far as `fn` itself is
 * idempotent. The pipeline's steps (parse, clean, calculate) are pure
 * transforms of their input with no external side effects, so re-running them
 * cannot duplicate anything. A step that acquires real side effects must carry
 * its own idempotency key before it is wrapped here.
 *
 * Standalone and framework-free (mirrors dataCleaningService / kpiService);
 * wired into uploadRoute.ts separately.
 */

export type StepStatus =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'retrying'
  | 'gave_up'
  | 'duplicate';

export interface ProcessingRun {
  /** Correlation id shared by every step and the HTTP response (X-Correlation-ID). */
  readonly runId: string;
  readonly startedAt: string;
  /** Internal: monotonic step counter within the run. Not set by hand. */
  seq: number;
}

export interface RunStepOptions {
  /** Max retries AFTER the first attempt. Default 2 (so up to 3 attempts). */
  retries?: number;
  /** Base backoff in ms; the wait before attempt N is backoffMs * 2^(N-2). Default 50. */
  backoffMs?: number;
  /** Per-attempt timeout. Omit to not race a timer (correct for synchronous fns). */
  timeoutMs?: number;
  /** Return false to make an error terminal (no retry). Default: every error retries. */
  isRetryable?: (err: unknown) => boolean;
  /** Injectable delay, for tests. Default: real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Merged into the `context` of every log line emitted for this step. */
  context?: Record<string, unknown>;
}

const SERVICE = 'backend';
const STEP_EVENT = 'processing_step';

type StepOutcome = 'pending' | 'success' | 'failure' | 'partial';

const OUTCOME_BY_STATUS: Record<StepStatus, StepOutcome> = {
  started: 'pending',
  succeeded: 'success',
  failed: 'partial',
  retrying: 'partial',
  gave_up: 'failure',
  // A duplicate short-circuit is not a failure — the request still gets a
  // correct answer — but it is worth noticing, so it logs at warn level.
  duplicate: 'success',
};

const LEVEL_BY_STATUS: Record<StepStatus, 'info' | 'warn' | 'error'> = {
  started: 'info',
  succeeded: 'info',
  failed: 'warn',
  retrying: 'warn',
  gave_up: 'error',
  duplicate: 'warn',
};

export interface StepLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  event: string;
  correlation_id: string;
  step: string;
  step_id: string;
  step_seq: number;
  attempt: number;
  status: StepStatus;
  outcome: StepOutcome;
  duration_ms?: number;
  error_class?: string;
  context: Record<string, unknown>;
}

export class TimeoutError extends Error {
  constructor(ms: number, step: string) {
    super(`Step "${step}" exceeded its ${ms}ms timeout.`);
    this.name = 'TimeoutError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorClassOf(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  return 'UnknownError';
}

function withTimeout<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms, step)), ms);
    void p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Build a step audit line. Pure (no I/O), so it can be asserted directly in
 * tests without spying on the console.
 */
export function buildStepEntry(args: {
  run: ProcessingRun;
  step: string;
  stepId: string;
  stepSeq: number;
  attempt: number;
  status: StepStatus;
  durationMs?: number;
  errorClass?: string;
  context?: Record<string, unknown>;
}): StepLogEntry {
  const entry: StepLogEntry = {
    timestamp: nowIso(),
    level: LEVEL_BY_STATUS[args.status],
    service: SERVICE,
    event: STEP_EVENT,
    correlation_id: args.run.runId,
    step: args.step,
    step_id: args.stepId,
    step_seq: args.stepSeq,
    attempt: args.attempt,
    status: args.status,
    outcome: OUTCOME_BY_STATUS[args.status],
    context: args.context ?? {},
  };
  if (args.durationMs !== undefined) entry.duration_ms = args.durationMs;
  if (args.errorClass !== undefined) entry.error_class = args.errorClass;
  return entry;
}

function emit(entry: StepLogEntry): void {
  // Structured JSON to stdout, same shape/route as the pipeline's other audit
  // lines (see uploadRoute.ts, kpiService.ts).
  console.log(JSON.stringify(entry));
}

/** Start a new processing run. Pass an explicit id to adopt an inbound correlation id. */
export function newRun(runId: string = randomUUID()): ProcessingRun {
  return { runId, startedAt: nowIso(), seq: 0 };
}

/**
 * Run one processing step under the trust spine: a unique id + explicit status
 * on every attempt, timestamped start and terminal lines, and capped
 * exponential-backoff retry for transient failures.
 *
 * `fn` receives the 1-based attempt number and MUST be safe to call more than
 * once (see the module doc). `runStep` controls how many times and when `fn`
 * is called; it makes no promise about side effects inside `fn`.
 */
export async function runStep<T>(
  run: ProcessingRun,
  step: string,
  fn: (attempt: number) => T | Promise<T>,
  options: RunStepOptions = {},
): Promise<T> {
  const retries = options.retries ?? 2;
  const backoffMs = options.backoffMs ?? 50;
  const isRetryable = options.isRetryable ?? (() => true);
  const sleep = options.sleep ?? realSleep;
  const context = options.context ?? {};

  run.seq += 1;
  const stepSeq = run.seq;
  const stepId = `${run.runId}-s${stepSeq}`;
  const maxAttempts = retries + 1;

  const log = (
    status: StepStatus,
    extra: { attempt: number; durationMs?: number; errorClass?: string },
  ): void => emit(buildStepEntry({ run, step, stepId, stepSeq, status, context, ...extra }));

  log('started', { attempt: 1 });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAtMs = Date.now();
    try {
      const call = Promise.resolve(fn(attempt));
      const result = options.timeoutMs
        ? await withTimeout(call, options.timeoutMs, step)
        : await call;
      log('succeeded', { attempt, durationMs: Date.now() - startedAtMs });
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAtMs;
      const errorClass = errorClassOf(err);
      log('failed', { attempt, durationMs, errorClass });

      const canRetry = attempt < maxAttempts && isRetryable(err);
      if (!canRetry) {
        log('gave_up', { attempt, durationMs, errorClass });
        throw err;
      }
      log('retrying', { attempt: attempt + 1 });
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }

  // Unreachable: the loop above either returns a value or throws. Present so
  // the function satisfies its return type without an `as` cast.
  throw new Error(`runStep("${step}") exited its retry loop without a result.`);
}

/**
 * Convenience predicate for `isRetryable`: treat errors whose `.name` is one of
 * `names` as terminal (deterministic failures like ParseError or validation),
 * and every other error as transient and worth retrying.
 */
export function terminalWhenNamed(...names: string[]): (err: unknown) => boolean {
  return (err: unknown) => !(err instanceof Error && names.includes(err.name));
}

/* ------------------------------------------------------------------ *
 * Idempotency — recognise an upload we have already fully processed   *
 * so a re-submit (double-click, client retry) is answered from the   *
 * previous run instead of parsed / cleaned / calculated a second     *
 * time. This is the "retry without duplicating data" guarantee at    *
 * the run level; `runStep` provides it at the step level.            *
 * ------------------------------------------------------------------ */

/**
 * Stable key for one upload's content. Same bytes + same filename => same key;
 * any change to either => a different key. Filename is included so two files
 * with identical contents but different names are treated as distinct uploads.
 */
export function deriveIdempotencyKey(buffer: Buffer, filename: string): string {
  return createHash('sha256').update(filename).update(' ').update(buffer).digest('hex');
}

interface RememberedRun<T> {
  runId: string;
  result: T;
}

/**
 * Bounded, in-memory FIFO cache of the most recently *remembered* runs. When it
 * is full the oldest entry is dropped. In-memory only and per-process by
 * design: durable dedupe belongs to a persistence story (STORY-014), not here.
 * A process restart empties it, after which an identical upload reprocesses and
 * is logged as a normal (non-duplicate) run.
 */
export class RecentRuns<T> {
  private readonly store = new Map<string, RememberedRun<T>>();
  private readonly maxEntries: number;

  constructor(maxEntries = 256) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  get(key: string): RememberedRun<T> | undefined {
    return this.store.get(key);
  }

  remember(key: string, value: RememberedRun<T>): void {
    // Re-inserting moves the key to the newest slot so a repeated upload keeps
    // the entry alive rather than letting it age out.
    this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export interface IdempotencyDecision<T> {
  key: string;
  duplicate: boolean;
  /** Present only when `duplicate` is true. */
  priorResult?: T;
  priorRunId?: string;
}

/**
 * Records the idempotency lookup as a step of `run` (`idempotency_check`, its
 * own `step_id`) and reports whether this upload has already been processed.
 *
 * On a hit the terminal line carries `status: 'duplicate'`; the caller MUST NOT
 * reprocess and should return `priorResult`. On a miss the caller runs the
 * pipeline and then calls `rememberRun` so the next identical upload hits.
 */
export function checkIdempotency<T>(
  run: ProcessingRun,
  registry: RecentRuns<T>,
  key: string,
): IdempotencyDecision<T> {
  run.seq += 1;
  const stepSeq = run.seq;
  const stepId = `${run.runId}-s${stepSeq}`;
  const log = (status: StepStatus, context: Record<string, unknown>): void =>
    emit(buildStepEntry({ run, step: 'idempotency_check', stepId, stepSeq, attempt: 1, status, context }));

  log('started', { idempotencyKey: key });

  const prior = registry.get(key);
  if (prior) {
    log('duplicate', { idempotencyKey: key, originalRunId: prior.runId });
    return { key, duplicate: true, priorResult: prior.result, priorRunId: prior.runId };
  }

  log('succeeded', { idempotencyKey: key });
  return { key, duplicate: false };
}

/** Record a completed run's result so a later identical upload is recognised. */
export function rememberRun<T>(
  registry: RecentRuns<T>,
  key: string,
  run: ProcessingRun,
  result: T,
): void {
  registry.remember(key, { runId: run.runId, result });
}
