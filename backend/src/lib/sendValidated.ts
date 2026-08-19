import { Response } from 'express';
import { ZodSchema } from 'zod';

/**
 * Validates an outbound response body against its declared contract before
 * sending it. Dev fails loud (surfaces the bug immediately); prod logs and
 * sends anyway, since a malformed-but-close response beats a hard 500 for
 * a contract bug that should have been caught in dev/CI.
 */
export function sendValidated<T>(
  res: Response,
  schema: ZodSchema<T>,
  status: number,
  payload: T,
): void {
  const result = schema.safeParse(payload);

  if (!result.success) {
    const logLine = {
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'backend',
      event: 'response_contract_violation',
      outcome: 'failure',
      error_class: 'ContractViolation',
      context: { issues: result.error.issues },
    };
    console.error(JSON.stringify(logLine));

    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Response failed its declared contract: ${result.error.message}`);
    }
  }

  res.status(status).json(payload);
}
