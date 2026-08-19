import ExcelJS from 'exceljs';
import { cleanFile, ParseError } from './dataCleaningService';

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  rows.forEach((row) => sheet.addRow(row));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('cleanFile', () => {
  it('cleans a valid CSV file (happy path)', async () => {
    const csv = Buffer.from('date,revenue\n2026-01-01,1000\n2026-01-02,1200\n');
    const result = await cleanFile(csv, 'sales.csv');
    expect(result.headers).toEqual(['date', 'revenue']);
    expect(result.cleanedRows).toHaveLength(2);
    expect(result.cleanedRows[0].data).toEqual({ date: '2026-01-01', revenue: '1000' });
    expect(result.flaggedRows).toHaveLength(0);
    expect(result.totalDataRows).toBe(2);
  });

  it('cleans a valid .xlsx file (happy path)', async () => {
    const buffer = await buildXlsxBuffer([
      ['date', 'revenue'],
      ['2026-01-01', 1000],
      ['2026-01-02', 1200],
    ]);
    const result = await cleanFile(buffer, 'report.xlsx');
    expect(result.headers).toEqual(['date', 'revenue']);
    expect(result.cleanedRows).toHaveLength(2);
    expect(result.flaggedRows).toHaveLength(0);
  });

  it('trims whitespace and drops fully empty rows', async () => {
    const csv = Buffer.from('date,revenue\n  2026-01-01 ,  1000  \n,,\n2026-01-02,1200\n');
    const result = await cleanFile(csv, 'sales.csv');
    expect(result.cleanedRows).toHaveLength(2);
    expect(result.cleanedRows[0].data).toEqual({ date: '2026-01-01', revenue: '1000' });
  });

  it('flags rows with missing cells instead of silently dropping them', async () => {
    const csv = Buffer.from('date,revenue\n2026-01-01,1000\n2026-01-02,\n');
    const result = await cleanFile(csv, 'sales.csv');
    expect(result.cleanedRows).toHaveLength(1);
    expect(result.flaggedRows).toHaveLength(1);
    expect(result.flaggedRows[0].reason).toMatch(/empty/i);
  });

  it('reports an error for a malformed CSV file', async () => {
    const malformed = Buffer.from('date,revenue\n"2026-01-01,1000\n');
    await expect(cleanFile(malformed, 'sales.csv')).rejects.toThrow(ParseError);
  });

  it('reports an error for a corrupt .xlsx file', async () => {
    const corrupt = Buffer.from('this is not a real xlsx file');
    await expect(cleanFile(corrupt, 'report.xlsx')).rejects.toThrow(ParseError);
  });

  it('reports an error for an empty file', async () => {
    const empty = Buffer.from('');
    await expect(cleanFile(empty, 'empty.csv')).rejects.toThrow(ParseError);
  });

  it('reports an error for an unsupported extension', async () => {
    const buf = Buffer.from('hello');
    await expect(cleanFile(buf, 'notes.txt')).rejects.toThrow(ParseError);
  });
});
