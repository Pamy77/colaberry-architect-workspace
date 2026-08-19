import request from 'supertest';
import { createApp } from '../app';

describe('POST /api/upload', () => {
  it('accepts a valid .csv file', async () => {
    const app = createApp();
    const csvBuffer = Buffer.from('date,revenue\n2026-01-01,1000\n');

    const res = await request(app)
      .post('/api/upload')
      .attach('file', csvBuffer, { filename: 'sales.csv', contentType: 'text/csv' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'accepted',
      filename: 'sales.csv',
      sizeBytes: csvBuffer.length,
      mimeType: 'text/csv',
    });
  });

  it('accepts a valid .xlsx file', async () => {
    const app = createApp();
    const fakeXlsxBuffer = Buffer.from('not real xlsx bytes, just testing the extension gate');

    const res = await request(app).post('/api/upload').attach('file', fakeXlsxBuffer, {
      filename: 'report.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.filename).toBe('report.xlsx');
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
});
