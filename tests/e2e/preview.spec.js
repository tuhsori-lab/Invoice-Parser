/**
 * Previewing a whole invoice - every page, to scroll through - and saving it
 * as its own PDF, from Reconcile and from Split.
 */

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('Reconcile previews every page of an invoice and downloads it under its number', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('tab-reconcile').click();
  await page.getByTestId('try-samples-reconcile').click();
  const results = page.getByTestId('section-results');
  await expect(results).toBeVisible({ timeout: 30_000 });

  // HL-24017 is pages 1 and 2 of the bulk file.
  const row = results.locator('tr', { hasText: 'HL-24017' }).first();
  await row.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('pdf-preview');
  await expect(preview).toContainText('Invoice HL-24017');
  await expect(preview).toContainText('2 pages');
  await expect(preview.locator('canvas')).toHaveCount(2);
  await expect(preview.getByText('Page 2 of 2')).toBeVisible();

  // Drawn in its own proportions: a Letter page is taller than it is wide.
  const box = await preview.locator('canvas').first().boundingBox();
  expect(box.height / box.width).toBeGreaterThan(1.2);
  await page.keyboard.press('Escape');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('button', { name: 'Download' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('HL-24017.pdf');
  const saved = await PDFDocument.load(readFileSync(await download.path()));
  expect(saved.getPageCount()).toBe(2);
});

test('Split previews a whole invoice to scroll through', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('try-samples').click();
  await expect(page.getByTestId('summary')).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId('invoice-table').locator('tr', { hasText: 'HL-24017' });
  await row.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByTestId('invoice-preview');
  await expect(preview).toContainText('Invoice HL-24017');
  await expect(preview.locator('canvas')).toHaveCount(2);

  // A page can still be opened on its own to fix it.
  await preview.locator('.preview-page-button').nth(1).click();
  await expect(page.getByTestId('page-text')).toBeVisible();
});
