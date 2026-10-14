/**
 * Whether an invoice says the same as its row in the spreadsheet: the amount,
 * and the purchase order it was raised against.
 *
 * The PDF is what the customer received, so it is the reference: a difference
 * is reported as the PDF against Excel, with how far apart they are. Nothing is
 * compared that either side leaves out - an empty cell is not a disagreement -
 * but a total the PDF did not show is said, so it can be looked at.
 */

import { poKey } from '../fields.js';
import { sheetAmount } from '../summary.js';

/** Amounts closer than this are the same: half a cent, for rounding in a sheet. */
const SAME_AMOUNT = 0.005;

/**
 * @param {object} [pdfFields] - readFields() of the invoice's pages.
 * @param {Record<string, string>} [sheetFields] - the row's amount, po and currency cells.
 * @returns {{
 *   amount: { pdf: number|null, sheet: number|null, difference: number|null, currency: string|null },
 *   po: { pdf: string|null, sheet: string|null },
 *   priceDiffers: boolean,
 *   poDiffers: boolean,
 *   notes: string[],
 * }}
 */
export function compareWithSheet(pdfFields = {}, sheetFields = {}) {
  const notes = [];
  const pdfTotal = pdfFields?.total ?? null;
  const sheetMoney = sheetAmount(sheetFields?.amount);
  const currency = pdfTotal?.currency ?? sheetMoney?.currency ?? null;

  let difference = null;
  let priceDiffers = false;
  if (pdfTotal && sheetMoney) {
    difference = Math.round((sheetMoney.amount - pdfTotal.amount) * 100) / 100;
    if (sheetMoney.currency && pdfTotal.currency && sheetMoney.currency !== pdfTotal.currency) {
      priceDiffers = true;
      notes.push(`Currency differs: PDF ${pdfTotal.currency}, Excel ${sheetMoney.currency}`);
    } else if (Math.abs(difference) > SAME_AMOUNT) {
      priceDiffers = true;
      notes.push(
        `Price differs: PDF ${pdfTotal.raw}, Excel ${sheetFields.amount} (Excel is ${formatMoney(Math.abs(difference), currency)} ${difference > 0 ? 'more' : 'less'})`
      );
    }
  } else if (sheetMoney && !pdfTotal) {
    notes.push('No total found on the PDF to check the amount against');
  }

  const pdfPo = pdfFields?.po?.value ?? null;
  const sheetPo = String(sheetFields?.po ?? '').trim() || null;
  const poDiffers = Boolean(pdfPo && sheetPo && poKey(pdfPo) !== poKey(sheetPo));
  if (poDiffers) notes.push(`PO differs: PDF ${pdfPo}, Excel ${sheetPo}`);
  else if (sheetPo && !pdfPo) notes.push('No PO found on the PDF to check against');

  return {
    amount: {
      pdf: pdfTotal?.amount ?? null,
      sheet: sheetMoney?.amount ?? null,
      difference: priceDiffers ? difference : null,
      currency,
    },
    po: { pdf: pdfPo, sheet: sheetPo },
    priceDiffers,
    poDiffers,
    notes,
  };
}

/** An amount for the table, in its currency when known: "$1,297.48", "€34.00", "12.50". */
export function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return '';
  if (!currency) {
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return amount.toLocaleString('en-US', { style: 'currency', currency });
}
