import express, { Express } from 'express';
import { uploadErrorHandler, uploadRouter } from './routes/uploadRoute';
import { dashboardRouter } from './routes/dashboardRoute';

export function createApp(): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api', uploadRouter);
  app.use('/api', dashboardRouter);
  app.use(uploadErrorHandler);

  return app;
}
