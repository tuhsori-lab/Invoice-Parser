/**
 * One invoice as its own PDF, from the file it came in: the pages that belong
 * to it, in order, named by its number. Built in this browser, like Split's.
 */
import { saveFile } from './download.js';

/** A file name from an invoice number, without characters a file name cannot have. */
export function invoiceFileName(item) {
  if (!item.invoice) return item.fileName;
  return `${String(item.invoice)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim()}.pdf`;
}

/**
 * Build and save one invoice's PDF.
 *
 * @param {{ file: File, fileId: string, fileName: string, invoice: string|null, pages: number[] }} item
 *   `pages` are its page numbers in the file, from 1; none means the whole file.
 */
export async function downloadInvoicePdf(item) {
  const [{ PDFDocument }, { buildInvoicePdf }] = await Promise.all([
    import('pdf-lib'),
    import('../core/export.js'),
  ]);
  const source = await PDFDocument.load(new Uint8Array(await item.file.arrayBuffer()));
  const numbers = item.pages?.length
    ? item.pages
    : source.getPageIndices().map((index) => index + 1);
  const group = {
    pages: numbers.map((number) => ({ fileId: item.fileId, filePageIndex: number - 1 })),
  };
  const bytes = await buildInvoicePdf(group, new Map([[item.fileId, source]]));
  const name = invoiceFileName(item);
  saveFile(bytes, name, 'application/pdf');
  return name;
}
