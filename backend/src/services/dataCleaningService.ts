import path from 'path';
import ExcelJS from 'exceljs';
import { parse as parseCsvSync } from 'csv-parse/sync';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface CleanedRow {
  rowNumber: number;
  data: Record<string, string>;
}

export interface FlaggedRow {
  rowNumber: number;
  data: Record<string, string>;
  reason: string;
}

export interface CleaningResult {
  headers: string[];
  cleanedRows: CleanedRow[];
  flaggedRows: FlaggedRow[];
  totalDataRows: number;
}

function parseCsvToRows(buffer: Buffer, filename: string): string[][] {
  try {
    return parseCsvSync(buffer, { skip_empty_lines: true, relax_column_count: true }) as string[][];
  } catch (err) {
    throw new ParseError(`Could not parse "${filename}" as CSV: ${(err as Error).message}`);
  }
}

async function parseExcelToRows(buffer: Buffer, filename: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch (err) {
    throw new ParseError(`Could not parse "${filename}" as Excel: ${(err as Error).message}`);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new ParseError(`"${filename}" contains no worksheets.`);
  }

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    const cells = values.slice(1).map((v) => (v === null || v === undefined ? '' : String(v)));
    rows.push(cells);
  });
  return rows;
}

function parseToRows(buffer: Buffer, filename: string): Promise<string[][]> {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.csv') {
    return Promise.resolve(parseCsvToRows(buffer, filename));
  }
  if (extension === '.xlsx' || extension === '.xls') {
    return parseExcelToRows(buffer, filename);
  }
  return Promise.reject(new ParseError(`Unsupported file extension "${extension}" for cleaning.`));
}

function cleanRows(rows: string[][]): CleaningResult {
  if (rows.length === 0) {
    throw new ParseError('File contains no rows.');
  }

  const headers = rows[0].map((h) => (h || '').trim());
  const dataRows = rows.slice(1);

  const cleanedRows: CleanedRow[] = [];
  const flaggedRows: FlaggedRow[] = [];

  dataRows.forEach((row, idx) => {
    const rowNumber = idx + 2; // +1 for the header row, +1 to make it 1-indexed
    const trimmedCells = headers.map((_, colIdx) => (row[colIdx] || '').trim());
    const isEmpty = trimmedCells.every((cell) => cell === '');
    if (isEmpty) return;

    const data: Record<string, string> = {};
    headers.forEach((header, colIdx) => {
      data[header] = trimmedCells[colIdx];
    });

    const hasMissingCell = trimmedCells.some((cell) => cell === '');
    if (hasMissingCell) {
      flaggedRows.push({ rowNumber, data, reason: 'One or more cells are empty' });
    } else {
      cleanedRows.push({ rowNumber, data });
    }
  });

  return { headers, cleanedRows, flaggedRows, totalDataRows: dataRows.length };
}

export async function cleanFile(buffer: Buffer, filename: string): Promise<CleaningResult> {
  const rows = await parseToRows(buffer, filename);
  return cleanRows(rows);
}
