import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { generateSummaryReport } from '../services/reportService';
import { ReportErrorResponse, ReportErrorResponseSchema, SummaryReportResponseSchema } from './reportContract';

/**
 * GET /api/reports/summary — a summary report of decisions made (STORY-008 /
 * REQ-012). Mirrors `dashboardRoute.ts`: a pure read, wrapped in a try/catch
 * for the (currently unreachable, but defensively present — same shape as
 * `DashboardUnavailable`) "Report generation failure" path.
 */

export const reportRouter = Router();

reportRouter.get('/reports/summary', (_req: Request, res: Response) => {
  try {
    const report = generateSummaryReport();
    // Same id in the header and the body — one id to trace a response back
    // to its exact report_generated log line, not two (see reportService.ts).
    res.setHeader('X-Correlation-ID', report.correlationId);
    sendValidated(res, SummaryReportResponseSchema, 200, report);
  } catch (_err) {
    const payload: ReportErrorResponse = {
      status: 'error',
      errorClass: 'ReportUnavailable',
      message: 'The summary report could not be generated. Try again in a moment.',
    };
    sendValidated(res, ReportErrorResponseSchema, 502, payload);
  }
});
