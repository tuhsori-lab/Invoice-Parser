/**
 * A small Excel workbook (.xlsx), made in memory for tests.
 *
 * Just enough of the format for a spreadsheet program - or this app - to read
 * it: one worksheet, every cell an inline string. The rows are whatever the
 * test passes; nothing here is real.
 */

import JSZip from 'jszip';

const escape = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const column = (index) => String.fromCharCode(65 + index);

/**
 * @param {string[][]} rows
 * @returns {Promise<Buffer>}
 */
export async function workbook(rows) {
  const sheetRows = rows
    .map(
      (cells, row) =>
        `<row r="${row + 1}">${cells
          .map(
            (cell, at) =>
              `<c r="${column(at)}${row + 1}" t="inlineStr"><is><t>${escape(cell)}</t></is></c>`
          )
          .join('')}</row>`
    )
    .join('');

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Open invoices" sheetId="1" r:id="rId1"/></sheets></workbook>'
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="worksheets/sheet1.xml" Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>' +
      '</Relationships>'
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
