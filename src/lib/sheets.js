/**
 * Reading and writing spreadsheets, with SheetJS.
 *
 * SheetJS is bundled with the app (installed from SheetJS's own release, not
 * fetched at run time) and only loaded the first time a spreadsheet is opened
 * or written, so an ordinary visit never downloads it. Files are read in this
 * browser and nowhere else.
 */

/** File types a spreadsheet may come as. */
export const SHEET_TYPES = ['.xlsx', '.xls', '.xlsm', '.csv', '.tsv', '.ods'];

/** A file the person meant as a spreadsheet, by its name. */
export function isSheetFile(file) {
  const name = String(file?.name ?? '').toLowerCase();
  return SHEET_TYPES.some((type) => name.endsWith(type));
}

export class SheetFileError extends Error {}

/**
 * Every sheet of a workbook, as rows of text cells.
 *
 * Cells come back as they are shown in Excel - "00123" stays "00123" - except
 * dates, which come back as YYYY-MM-DD: Excel keeps a real date, and shown as
 * "03/04/26" it would read one way in the US and the other in Europe. Blank rows
 * are kept, so a row's place in the list is its row in the sheet.
 *
 * @param {File} file
 * @returns {Promise<Array<{ name: string, rows: string[][], firstRow: number }>>}
 *   firstRow is the sheet row the first of `rows` is on, counting from 1.
 */
export async function readWorkbook(file) {
  if (!isSheetFile(file)) {
    throw new SheetFileError(
      `${file?.name ?? 'This file'} is not a spreadsheet. Use an Excel file (.xlsx or .xls) or a .csv.`
    );
  }
  const XLSX = await import('xlsx');
  let workbook;
  try {
    workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), {
      type: 'array',
      cellDates: false,
      cellHTML: false,
      // Formulas are read as the values they show; they are never run.
      cellFormula: false,
      // Each cell's number format, to tell a date from a plain number.
      cellNF: true,
      // A CSV's cells stay text as written: "00123" is not turned into 123.
      raw: /\.(csv|tsv)$/i.test(file.name),
    });
  } catch {
    throw new SheetFileError(
      `${file.name} could not be opened. It may be damaged, or password-protected. Try saving it again as .xlsx or .csv.`
    );
  }
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) return { name, rows: [], firstRow: 1 };
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!') || cell?.t !== 'n' || !cell.z || !XLSX.SSF.is_date(cell.z))
        continue;
      const { y, m, d } = XLSX.SSF.parse_date_code(cell.v);
      cell.w = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    });
    return {
      name,
      rows: rows.map((row) => row.map((cell) => String(cell ?? ''))),
      firstRow: range.s.r + 1,
    };
  });
  if (!sheets.some((sheet) => sheet.rows.length > 0)) {
    throw new SheetFileError(`${file.name} has nothing in it.`);
  }
  return sheets;
}

/**
 * A workbook with one sheet per list of rows, ready to save.
 *
 * @param {Array<{ name: string, rows: Array<Array<string|number>> }>} sheets
 * @returns {Promise<Blob>}
 */
export async function writeWorkbook(sheets) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const used = new Set();
  for (const { name, rows } of sheets) {
    // Excel allows 31 characters and none of : \ / ? * [ ]
    let safe = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
    while (used.has(safe)) safe = `${safe.slice(0, 28)} ${used.size}`;
    used.add(safe);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    // Wide enough to read without dragging every column out.
    sheet['!cols'] = (rows[0] ?? []).map((_, column) => ({
      wch: Math.min(60, Math.max(10, ...rows.map((row) => String(row[column] ?? '').length + 2))),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, safe);
  }
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
