/**
 * An invoice number from a file's name, for a PDF whose own text gives none.
 *
 * "Invoice INV-2026-0042.pdf" gives "INV-2026-0042"; "104233_PO-9921.pdf" - the
 * name Split gives an invoice with its PO - gives "104233". Whatever comes from
 * a file name is marked so, because a name is only what somebody typed.
 */

/** A word that says the invoice number comes next. */
const LEAD =
  /(?:^|[^a-z])(?:invoice|inv|rechnung|facture|factura|fattura|bill)\.?[\s_#:.-]*(?:(?:no|nr|num|number)\.?[\s_#:.-]*)?([a-z0-9][a-z0-9/_.-]*)/i;

/** How many digits a piece of text has. */
const digits = (text) => (String(text).match(/\d/g) ?? []).length;

/**
 * @param {string} name - the file's name, with or without a folder in front.
 * @returns {string|null} the number as written in the name, or null.
 */
export function numberFromFileName(name) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]{1,5}$/i, '');
  if (!base) return null;

  const led = LEAD.exec(base)?.[1]?.replace(/[._-]+$/, '');
  if (led && digits(led) >= 3) return led;

  // Otherwise the piece of the name with the most digits in it.
  const pieces = base.split(/[\s_()[\],]+/).map((piece) => piece.replace(/^[.-]+|[.-]+$/g, ''));
  let best = null;
  for (const piece of pieces) {
    if (digits(piece) < 3) continue;
    if (!best || digits(piece) > digits(best)) best = piece;
  }
  return best;
}
