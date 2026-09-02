import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../app';
import { recentRuns } from './uploadRoute';
import * as dataCleaningService from '../services/dataCleaningService';

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Parse the structured JSON audit lines captured by a console.log spy. */
function auditLines(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(call[0] as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((l): l is Record<string, unknown> => l !== null);
}

describe('POST /api/upload', () => {
  // The dedup registry is a module singleton shared across cases in this file.
  beforeEach(() => recentRuns.clear());
  afterEach(() => jest.restoreAllMocks());

  it('accepts a valid .csv file and returns a cleaning summary', async () => {
    const app = createApp();
    const csvBuffer = Buffer.from('date,revenue\n2026-01-01,1000\n2026-01-02,\n');

    const res = await request(app)
      .post('/api/upload')
      .attach('file', csvBuffer, { filename: 'sales.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    // toMatchObject: the cleaning contract is asserted exactly; the kpis block
    // (added in STORY-002) is covered by its own tests below.
    expect(res.body).toMatchObject({
      status: 'accepted',
      filename: 'sales.csv',
      sizeBytes: csvBuffer.length,
      mimeType: 'text/csv',
      cleaning: {
        headers: ['date', 'revenue'],
        totalDataRows: 2,
        cleanedRowCount: 1,
        flaggedRowCount: 1,
        flaggedRows: [{ rowNumber: 3, reason: 'One or more cells are empty' }],
      },
    });
    expect(res.body.kpis).toBeDefined();
  });

  it('accepts a valid .xlsx file and cleans it', async () => {
    const app = createApp();
    const xlsxBuffer = await buildXlsxBuffer([
      ['date', 'revenue'],
      ['2026-01-01', 1000],
      ['2026-01-02', 1200],
    ]);

    const res = await request(app).post('/api/upload').attach('file', xlsxBuffer, {
      filename: 'report.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.filename).toBe('report.xlsx');
    expect(res.body.cleaning.cleanedRowCount).toBe(2);
    expect(res.body.cleaning.flaggedRowCount).toBe(0);
  });

  it('rejects an unsupported file format', async () => {
    const app = createApp();
    const txtBuffer = Buffer.from('just some text');

    const res = await request(app)
      .post('/api/upload')
      .attach('file', txtBuffer, { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.errorClass).toBe('ValidationError');
    expect(res.body.message).toMatch(/unsupported file type/i);
  });

  it('rejects a request with no file attached', async () => {
    const app = createApp();

    const res = await request(app).post('/api/upload');

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.errorClass).toBe('ValidationError');
    expect(res.body.message).toMatch(/no file uploaded/i);
  });

  it('reports an error for a malformed Excel file (valid extension, corrupt content)', async () => {
    const app = createApp();
    const corruptBuffer = Buffer.from('this looks like an xlsx by name only, not by content');

    const res = await request(app).post('/api/upload').attach('file', corruptBuffer, {
      filename: 'report.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.errorClass).toBe('ValidationError');
    expect(res.body.message).toMatch(/could not parse/i);
  });

  it('calculates KPIs from cleaned data and logs the calculation with evidence levels', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const app = createApp();
      const csvBuffer = Buffer.from('month,revenue,expenses\nJan,1000,600\nFeb,1200,700\n');

      const res = await request(app)
        .post('/api/upload')
        .attach('file', csvBuffer, { filename: 'sales.csv', contentType: 'text/csv' });

      expect(res.status).toBe(200);
      expect(res.body.kpis.status).toBe('ok');
      expect(res.body.kpis.clarificationsNeeded).toEqual([]);

      const revenueTotal = res.body.kpis.kpis.find((k: { key: string }) => k.key === 'business.revenue.total');
      const grossProfit = res.body.kpis.kpis.find((k: { key: string }) => k.key === 'business.profit.gross');
      expect(revenueTotal.value).toBe(2200);
      expect(revenueTotal.evidenceLevel).toBe('high');
      expect(grossProfit.value).toBe(900);

      const kpiLogLine = logSpy.mock.calls
        .map((call) => {
          try {
            return JSON.parse(call[0] as string);
          } catch {
            return null;
          }
        })
        .find((line) => line && line.event === 'kpi_calculation');
      expect(kpiLogLine).toBeDefined();
      expect(kpiLogLine.context.evidence.length).toBeGreaterThan(0);
      expect(kpiLogLine.context.evidence[0]).toHaveProperty('evidenceLevel');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('returns 200 with clarificationsNeeded when the data is incomplete', async () => {
    const app = createApp();
    // "oops" makes the revenue column inconsistent; the upload itself is fine.
    const csvBuffer = Buffer.from('item,revenue\na,100\nb,oops\nc,300\n');

    const res = await request(app)
      .post('/api/upload')
      .attach('file', csvBuffer, { filename: 'sales.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.kpis.status).toBe('needs_clarification');
    expect(res.body.kpis.clarificationsNeeded.some((c: { code: string }) => c.code === 'inconsistent_column')).toBe(
      true,
    );
    // Partial KPIs are still returned, not withheld.
    expect(res.body.kpis.kpis.length).toBeGreaterThan(0);
  });

  it('logs every processing step with a unique id, a status and a timestamp (STORY-011)', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const res = await request(createApp())
        .post('/api/upload')
        .attach('file', Buffer.from('month,revenue\nJan,100\nFeb,200\n'), {
          filename: 'trail.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(200);
      const correlationId = res.headers['x-correlation-id'];
      expect(correlationId).toMatch(/[0-9a-f-]{36}/);

      const steps = auditLines(logSpy).filter((l) => l.event === 'processing_step');
      const byStep = (name: string) => steps.filter((l) => l.step === name);

      // Every data-processing step is present, in order, each with its own id.
      expect(byStep('receive_upload').length).toBeGreaterThan(0);
      expect(byStep('idempotency_check').length).toBeGreaterThan(0);
      expect(byStep('clean_data').length).toBeGreaterThan(0);
      expect(byStep('calculate_kpis').length).toBeGreaterThan(0);

      const stepIds = new Set(steps.map((l) => l.step_id));
      expect(stepIds.size).toBe(4); // 4 distinct steps, 4 distinct ids

      for (const line of steps) {
        expect(line.correlation_id).toBe(correlationId);
        expect(typeof line.timestamp).toBe('string');
        expect(new Date(line.timestamp as string).toString()).not.toBe('Invalid Date');
        expect(['started', 'succeeded', 'failed', 'retrying', 'gave_up', 'duplicate']).toContain(line.status);
      }
      // Each step opened and closed cleanly.
      for (const name of ['receive_upload', 'idempotency_check', 'clean_data', 'calculate_kpis']) {
        expect(byStep(name).map((l) => l.status)).toEqual(['started', 'succeeded']);
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  it('retries a transient processing error without duplicating data', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const realCleanFile = dataCleaningService.cleanFile;
    const cleanSpy = jest.spyOn(dataCleaningService, 'cleanFile');
    // Attempt 1 fails with a non-deterministic error; attempt 2 runs for real.
    cleanSpy.mockRejectedValueOnce(new Error('transient parse worker hiccup'));
    cleanSpy.mockImplementation((...args) => realCleanFile(...args));

    try {
      const res = await request(createApp())
        .post('/api/upload')
        .attach('file', Buffer.from('month,revenue\nJan,1000\nFeb,1200\n'), {
          filename: 'retry.csv',
          contentType: 'text/csv',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accepted');
      // The retry produced exactly one correct result — rows are not doubled.
      expect(res.body.cleaning.cleanedRowCount).toBe(2);
      expect(res.body.cleaning.totalDataRows).toBe(2);
      expect(cleanSpy).toHaveBeenCalledTimes(2); // one failed attempt + one success, no more

      const cleanSteps = auditLines(logSpy).filter(
        (l) => l.event === 'processing_step' && l.step === 'clean_data',
      );
      expect(cleanSteps.map((l) => l.status)).toEqual(['started', 'failed', 'retrying', 'succeeded']);
      expect(new Set(cleanSteps.map((l) => l.step_id)).size).toBe(1); // all one step
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not reprocess a byte-identical re-upload; answers it from the previous run', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const realCleanFile = dataCleaningService.cleanFile;
    const cleanSpy = jest
      .spyOn(dataCleaningService, 'cleanFile')
      .mockImplementation((...args) => realCleanFile(...args));

    try {
      const app = createApp();
      const csv = Buffer.from('month,revenue,expenses\nJan,1000,600\nFeb,1200,700\n');
      const send = () =>
        request(app).post('/api/upload').attach('file', csv, {
          filename: 'dup.csv',
          contentType: 'text/csv',
        });

      const first = await send();
      const second = await send();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body); // identical answer
      expect(cleanSpy).toHaveBeenCalledTimes(1); // second upload never re-parsed

      // Both requests are individually traceable, and the duplicate is logged.
      expect(first.headers['x-correlation-id']).not.toBe(second.headers['x-correlation-id']);
      const dupLine = auditLines(logSpy).find(
        (l) => l.event === 'processing_step' && l.step === 'idempotency_check' && l.status === 'duplicate',
      );
      expect(dupLine).toBeDefined();
      expect(dupLine?.correlation_id).toBe(second.headers['x-correlation-id']);
      expect((dupLine?.context as Record<string, unknown>).originalRunId).toBe(
        first.headers['x-correlation-id'],
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
