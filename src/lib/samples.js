/**
 * The made-up sample files that ship with the app, so it can be tried without
 * any invoices to hand. Fetched from this app's own address, like the rest of it.
 */

export const SAMPLE_PDFS = [
  'bulk-invoices.pdf',
  'scanned-invoices.pdf',
  'single-invoices/Copperfield CF-2026-0433.pdf',
  'single-invoices/harbor-lane-24031.pdf',
  'single-invoices/Invoice INV-5521.pdf',
  'single-invoices/northwind_sept_invoice.pdf',
];

export const SAMPLE_SHEET = 'invoice-register.xlsx';

/**
 * Fetch sample files as File objects, the same as files a person dropped in.
 *
 * @param {string[]} paths - under public/samples.
 * @returns {Promise<Array<{ file: File, path: string }>>}
 */
export async function loadSamples(paths) {
  return Promise.all(
    paths.map(async (path) => {
      const url = `${import.meta.env.BASE_URL}samples/${path.split('/').map(encodeURIComponent).join('/')}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load the sample ${path}.`);
      const blob = await response.blob();
      const name = path.split('/').pop();
      return { file: new File([blob], name, { type: blob.type }), path };
    })
  );
}
