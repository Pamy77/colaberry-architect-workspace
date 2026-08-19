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
    expect(res.body).toEqual({
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
});
