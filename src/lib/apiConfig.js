/**
 * Whether this build talks to your own invoice OCR server, and where.
 *
 * Kept apart from invoiceApi.js so a build without a server loads none of that
 * code: VITE_INVOICE_API_URL is fixed at build time, and when it is empty the
 * app never sends a file anywhere.
 */
const configured = (import.meta.env.VITE_INVOICE_API_URL ?? '').trim().replace(/\/+$/, '');

/** Only HTTPS leaves this computer; plain HTTP is allowed to this machine alone, for development. */
function safe(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

export const API_URL = configured && safe(configured) ? configured : '';
export const apiEnabled = Boolean(API_URL);
export const apiHost = apiEnabled ? new URL(API_URL).host : '';

const TOKEN_KEY = 'invoice-splitter.api-token.v1';

export function loadToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? window.localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Keep the token for this tab only, or, if asked, on this computer until signing out. */
export function saveToken(token, remember) {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    if (remember) window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Kept in memory for this visit only.
  }
}

export function forgetToken() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing was stored.
  }
}
