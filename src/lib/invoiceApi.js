/**
 * Talking to your own invoice OCR server (services/), when this build has one.
 *
 * Off unless the site was built with VITE_INVOICE_API_URL. Without it, nothing
 * here runs and the app never sends a file anywhere, exactly as before.
 *
 * The build holds only the server's address, never a secret: each person signs
 * in with their own access token, kept in this browser.
 */
import {
  DocumentList,
  DocumentResult,
  CorrectionRequest,
} from '../../packages/invoice-schema/index.ts';
import { API_URL, apiHost } from './apiConfig.js';

export { API_URL, apiEnabled, apiHost, forgetToken, loadToken, saveToken } from './apiConfig.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(token, path, { method = 'GET', body, json = true } = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, `Could not reach ${apiHost}. Check the server is running.`);
  }
  if (!response.ok) {
    const detail = await response.json().then(
      (data) => data.detail,
      () => null
    );
    throw new ApiError(
      response.status,
      typeof detail === 'string' ? detail : `The server said ${response.status}.`
    );
  }
  return json ? response.json() : response.arrayBuffer();
}

export async function listInvoices(token) {
  return DocumentList.parse(await call(token, '/invoices')).invoices;
}

export async function getResult(token, id) {
  return DocumentResult.parse(await call(token, `/invoices/${encodeURIComponent(id)}/result`));
}

export function getFile(token, id) {
  return call(token, `/invoices/${encodeURIComponent(id)}/file`, { json: false });
}

export async function saveCorrections(token, id, corrections, approve = false) {
  const body = CorrectionRequest.parse({ corrections, approve });
  return DocumentResult.parse(
    await call(token, `/invoices/${encodeURIComponent(id)}/corrections`, { method: 'PATCH', body })
  );
}

export function retryInvoice(token, id) {
  return call(token, `/invoices/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

/** Upload one file, reporting progress. fetch() cannot report upload progress; XHR can. */
export function uploadInvoice(token, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', `${API_URL}/invoices`);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    request.onload = () => {
      let data = null;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        // Not JSON: the status says enough.
      }
      if (request.status >= 200 && request.status < 300) resolve(data);
      else
        reject(new ApiError(request.status, data?.detail ?? `The server said ${request.status}.`));
    };
    request.onerror = () => reject(new ApiError(0, `Could not reach ${apiHost}.`));
    const form = new FormData();
    form.append('file', file, file.name);
    request.send(form);
  });
}
