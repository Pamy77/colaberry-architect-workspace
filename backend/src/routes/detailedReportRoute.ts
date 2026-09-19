import { Router, Request, Response } from 'express';
import { sendValidated } from '../lib/sendValidated';
import { generateDetailedReport, type DataSourceName } from '../services/detailedReportService';
import {
  DataSourceNameSchema,
  DetailedReportErrorResponse,
  DetailedReportErrorResponseSchema,
  DetailedReportResponseSchema,
} from './detailedReportContract';

/**
 * GET /api/reports/detailed?sources=kpis,financial&templateId=full_detail —
 * a detailed report for analysts (STORY-013 / REQ-016). A pure read, same
 * "GET, not POST" shape as `reportRoute.ts`, extended with query params
 * since this one takes them.
 */

export const detailedReportRouter = Router();

/** A comma-separated `sources` query param, filtered to recognized values. Unknown/malformed -> undefined (falls back to the service's "all sources" default), never a 400 for a filter param. */
function parseSources(raw: unknown): DataSourceName[] | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const candidates = raw.split(',').map((s) => s.trim());
  const valid = candidates.filter((c): c is DataSourceName => DataSourceNameSchema.safeParse(c).success);
  return valid.length > 0 ? valid : undefined;
}

detailedReportRouter.get('/reports/detailed', (req: Request, res: Response) => {
  try {
    const sources = parseSources(req.query.sources);
    const templateId = typeof req.query.templateId === 'string' ? req.query.templateId : undefined;

    const report = generateDetailedReport({ sources, templateId });
    // Same id in the header and the body, same fix already made this
    // session in syncRoute.ts / reportRoute.ts.
    res.setHeader('X-Correlation-ID', report.correlationId);

    const status = report.status === 'invalid_template' ? 400 : 200;
    sendValidated(res, DetailedReportResponseSchema, status, report);
  } catch (_err) {
    // Data source unavailability: currently unreachable (every read here is
    // synchronous and in-memory), but present defensively — same shape as
    // dashboardRoute.ts's DashboardUnavailable / reportRoute.ts's ReportUnavailable.
    const payload: DetailedReportErrorResponse = {
      status: 'error',
      errorClass: 'DataSourceUnavailable',
      message: 'The detailed report could not be generated. Try again in a moment.',
    };
    sendValidated(res, DetailedReportErrorResponseSchema, 502, payload);
  }
});
