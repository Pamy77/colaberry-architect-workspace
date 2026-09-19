import { randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import {
  LogInteractionErrorResponse,
  LogInteractionErrorResponseSchema,
  LogInteractionRequestSchema,
  LogInteractionResponseSchema,
} from './uiInteractionContract';

/**
 * POST /api/ui/interactions — logs a UI interaction (STORY-010; see
 * `directives/12-ui-simplicity.md`). Fire-and-forget from the frontend's
 * perspective: this endpoint never fails the caller's primary action, it
 * only records that something happened.
 */

export const uiInteractionRouter = Router();

function logUiInteraction(
  correlationId: string,
  event: string,
  context: Record<string, unknown> | undefined,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'backend',
      event: 'ui_interaction',
      correlation_id: correlationId,
      interaction: event,
      context: context ?? {},
    }),
  );
}

uiInteractionRouter.post('/ui/interactions', (req: Request, res: Response) => {
  const correlationId = randomUUID();
  res.setHeader('X-Correlation-ID', correlationId);

  const parsed = LogInteractionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    const payload: LogInteractionErrorResponse = {
      status: 'error',
      errorClass: 'ValidationError',
      message: 'An "event" name is required.',
    };
    sendValidated(res, LogInteractionErrorResponseSchema, 400, payload);
    return;
  }

  logUiInteraction(correlationId, parsed.data.event, parsed.data.context);
  sendValidated(res, LogInteractionResponseSchema, 200, { status: 'logged', correlationId });
});
