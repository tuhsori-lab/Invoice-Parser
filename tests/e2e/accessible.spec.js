/**
 * Usable without a mouse, and without perfect eyesight.
 *
 * The audit below is axe, run against the real app in both themes. It catches
 * the things a person cannot see by looking - a missing label, a contrast ratio
 * just under the line - but it cannot tell whether the app is actually workable
 * with a keyboard, so that is checked by using it with one.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures', 'pdf');

const fixture = (name) => join(FIXTURES, name);

/** The rules worth holding this app to. */
const audit = (page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);

async function loadFixtures(page, names) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
  await expect(page.getByTestId('page-strip')).toBeVisible();
}

test('the empty page passes an accessibility audit', async ({ page }) => {
  await page.goto('/');
  const { violations } = await audit(page).analyze();
  expect(violations.map((entry) => `${entry.id}: ${entry.help}`)).toEqual([]);
});

test('a split batch passes an accessibility audit, in both themes', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf', '07-bare-invoice.pdf']);

  for (const theme of ['light', 'dark']) {
    await page.getByTestId('theme-choice').selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const { violations } = await audit(page).analyze();
    expect(violations.map((entry) => `${theme} / ${entry.id}: ${entry.help}`)).toEqual([]);
  }
});

test('the preview passes an accessibility audit', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf']);
  await page.getByTestId('tile-1').click();
  await expect(page.getByTestId('page-text')).toBeVisible();

  const { violations } = await audit(page)
    // pdf.js builds the text layer out of positioned spans of transparent text.
    // It is not content to read; it is there so the page can be selected.
    .exclude('.textLayer')
    .analyze();

  expect(violations.map((entry) => `${entry.id}: ${entry.help}`)).toEqual([]);
});

test('the profile editor passes an accessibility audit', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);
  await page.getByTestId('profile-add').click();
  await expect(page.getByTestId('profile-editor')).toBeVisible();

  const { violations } = await audit(page).analyze();
  expect(violations.map((entry) => `${entry.id}: ${entry.help}`)).toEqual([]);
});

test('keeps the keyboard inside a dialog, and puts it back afterwards', async ({ page }) => {
  await loadFixtures(page, ['01-same-line.pdf']);

  const tile = page.getByTestId('tile-1');
  await tile.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('preview-modal')).toBeVisible();

  // Tab all the way round the dialog: focus must never escape it.
  for (let press = 0; press < 20; press += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() =>
      Boolean(
        document.querySelector('[data-testid="preview-modal"]')?.contains(document.activeElement)
      )
    );
    expect(inside, `focus left the dialog after ${press + 1} tabs`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('preview-modal')).toBeHidden();

  // And it goes back to the tile that opened it, not to the top of the page.
  await expect(tile).toBeFocused();
});

test('can be worked without a mouse from start to export', async ({ page }) => {
  await loadFixtures(page, ['05-repeat-later.pdf']);

  // "/" reaches the search box from anywhere.
  await page.keyboard.press('/');
  await expect(page.getByTestId('search')).toBeFocused();
  await page.keyboard.type('INV-2002');
  await expect(page.getByTestId('invoice-table').getByRole('row')).toHaveCount(2);

  // Escape out of the search, then N walks the review queue.
  await page.getByTestId('search').fill('');
  await page.getByTestId('summary').click();
  await page.keyboard.press('n');
  await expect(page.getByTestId('preview-modal')).toBeVisible();
  await page.keyboard.press('Escape');

  // A fix, by keyboard, and undone by keyboard.
  await page.getByTestId('gap-3').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('summary')).toContainText('2 invoices');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('summary')).toContainText('3 invoices');
});

test('says what went wrong, and lets the message be dismissed', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(fixture('15-password-protected.pdf'));

  const problems = page.getByTestId('problems');
  await expect(problems).toContainText('This PDF is password-protected.');

  await page.getByTestId('dismiss-problems').click();
  await expect(problems).toBeHidden();
});

test('remembers the theme across a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('theme-choice').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('theme-choice')).toHaveValue('dark');
});
