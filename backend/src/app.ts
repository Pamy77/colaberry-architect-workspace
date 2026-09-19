import express, { Express } from 'express';
import { uploadErrorHandler, uploadRouter } from './routes/uploadRoute';
import { dashboardRouter } from './routes/dashboardRoute';
import { alertsRouter } from './routes/alertsRoute';
import { syncRouter } from './routes/syncRoute';
import { subscriptionRouter } from './routes/subscriptionRoute';
import { reportRouter } from './routes/reportRoute';
import { detailedReportRouter } from './routes/detailedReportRoute';
import { feedbackRouter } from './routes/feedbackRoute';

export function createApp(): Express {
  const app = express();
  // JSON body parsing, global: only affects requests with a JSON Content-Type,
  // so it does not interfere with uploadRoute's multipart/form-data handling
  // via multer. Added for subscriptionRoute (STORY-006) — the first route in
  // this app that needs a parsed JSON request body.
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api', uploadRouter);
  app.use('/api', dashboardRouter);
  app.use('/api', alertsRouter);
  app.use('/api', syncRouter);
  app.use('/api', subscriptionRouter);
  app.use('/api', reportRouter);
  app.use('/api', detailedReportRouter);
  app.use('/api', feedbackRouter);
  app.use(uploadErrorHandler);

  return app;
}
