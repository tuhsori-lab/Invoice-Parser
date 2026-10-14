/**
 * The Extract tab, in a build pointed at an OCR server (VITE_INVOICE_API_URL).
 *
 * The server is played by page.route, from a response the real backend wrote
 * (packages/invoice-schema/fixtures/sample-result.json), so this checks the
 * browser's side of the contract without running Python.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'http://127.0.0.1:4199/api';
const TOKEN = 'test-token-not-a-secret';
const sample = JSON.parse(
  readFileSync(
    join(HERE, '..', '..', 'packages', 'invoice-schema', 'fixtures', 'sample-result.json')
  )
);
const pdf = readFileSync(join(HERE, '..', 'fixtures', 'pdf', '01-same-line.pdf'));

test.use({ baseURL: 'http://127.0.0.1:4174' });

/** A pretend server: one invoice that goes from queued to needing review. */
function fakeServer(page) {
  const state = { docs: [], patches: [], polls: 0 };
  const summary = (doc) => ({
    id: doc.id,
    filename: doc.filename,
    status: doc.status,
    attempts: 1,
    error: null,
    created: '2026-10-14T09:00:00+00:00',
    updated: '2026-10-14T09:00:05+00:00',
    reviewed_by: doc.reviewed_by ?? null,
    reviewed_at: doc.reviewed_by ? '2026-10-14T09:10:00+00:00' : null,
  });
  page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
    if (request.headers().authorization !== `Bearer ${TOKEN}`) {
      return route.fulfill({ status: 401, json: { detail: 'That access token is not valid.' } });
    }
    const path = new URL(request.url()).pathname.replace('/api', '');
    if (path === '/invoices' && request.method() === 'POST') {
      state.docs.push({ id: sample.id, filename: 'northwind.pdf', status: 'queued' });
      return route.fulfill({ status: 202, json: { id: sample.id, status: 'queued' } });
    }
    if (path === '/invoices') {
      // Reading takes a moment: queued, then processing, then done.
      state.polls += 1;
      for (const doc of state.docs) {
        if (doc.status === 'queued') doc.status = 'processing';
        else if (doc.status === 'processing' && state.polls > 2) doc.status = 'needs_review';
      }
      return route.fulfill({ json: { invoices: state.docs.map(summary) } });
    }
    const doc = state.docs[0];
    if (path.endsWith('/file')) {
      return route.fulfill({ body: pdf, contentType: 'application/pdf' });
    }
    if (path.endsWith('/result')) {
      return route.fulfill({
        json: { ...sample, ...summary(doc), result: { ...sample.result, status: doc.status } },
      });
    }
    if (path.endsWith('/corrections')) {
      const body = request.postDataJSON();
      state.patches.push(body);
      if (body.approve) {
        doc.status = 'accepted';
        doc.reviewed_by = 'alice';
      }
      return route.fulfill({
        json: {
          ...sample,
          ...summary(doc),
          corrections: { ...sample.corrections, ...body.corrections },
          result: { ...sample.result, status: doc.status },
        },
      });
    }
    return route.fulfill({ status: 404, json: { detail: 'No such invoice.' } });
  });
  return state;
}

test('reads an invoice on the server, shows where each field came from, and takes a review', async ({
  page,
}) => {
  const server = fakeServer(page);
  await page.goto('/');
  await page.getByTestId('tab-extract').click();

  // Honest about what leaves the browser, and where to.
  await expect(page.getByTestId('upload-notice')).toContainText('127.0.0.1:4199');
  await expect(page.locator('.privacy-note')).toHaveText('Files go only to your own server');

  await page.getByTestId('api-token').fill('wrong');
  await page.getByTestId('connect').click();
  await expect(page.getByRole('alert')).toContainText('not valid');
  await page.getByTestId('api-token').fill(TOKEN);
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('extract-empty')).toBeVisible();

  await page.getByTestId('extract-drop-input').setInputFiles({
    name: 'northwind.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  const list = page.getByTestId('section-extracted');
  await expect(list).toContainText('northwind.pdf');
  await expect(list.locator('tbody tr').first()).toContainText('Needs review', { timeout: 15_000 });

  await list.getByRole('button', { name: 'northwind.pdf' }).click();
  const review = page.getByTestId('review');
  await expect(review.getByTestId('field-invoice_number')).toHaveValue(
    sample.result.invoice.invoice_number.value
  );
  await expect(review.getByTestId('line-items').locator('tbody tr')).toHaveCount(
    sample.result.invoice.line_items.length
  );

  // Looking at a field shows where on the page it was read.
  await review.getByTestId('field-total_due').focus();
  await expect(page.getByTestId('evidence-box')).toBeVisible();

  await review.getByTestId('field-purchase_order').fill('PO-777');
  await review.getByTestId('approve').click();
  await expect(review.getByTestId('review-status')).toHaveText('Accepted');
  expect(server.patches.at(-1)).toEqual({
    corrections: { purchase_order: 'PO-777' },
    approve: true,
  });

  // Signing out forgets the token.
  await page.getByTestId('sign-out').click();
  await expect(page.getByTestId('api-token')).toBeVisible();
  const stored = await page.evaluate(() => [
    ...Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)),
    ...Object.keys(localStorage).map((key) => localStorage.getItem(key)),
  ]);
  expect(stored).not.toContain(TOKEN);
});
