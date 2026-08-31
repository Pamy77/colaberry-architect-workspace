import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../app';

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('POST /api/upload', () => {
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
});
