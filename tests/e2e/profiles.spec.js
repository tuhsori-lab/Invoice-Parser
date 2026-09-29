/**
 * Teaching the app one client's way of printing invoices.
 *
 * This is what turns a batch nothing recognises into one that splits itself:
 * highlight the words the number comes after, say whose invoice it is, and
 * every page from that client is read the same way from then on.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures', 'pdf');

const fixture = (name) => join(FIXTURES, name);

async function loadFixtures(page, names) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
  await expect(page.getByTestId('page-strip')).toBeVisible();
}

/**
 * Highlight a phrase in the preview's text layer, the way a person drags
 * across it with the mouse.
 */
async function highlight(page, phrase) {
  // The text layer is built after the page has been drawn, so wait for the
  // words to actually be there before trying to select them.
  await page.locator('.textLayer span', { hasText: phrase }).first().waitFor();
  await page.evaluate((wanted) => {
    const span = [...document.querySelectorAll('.textLayer span')].find((entry) =>
      entry.textContent.includes(wanted)
    );
    if (!span) throw new Error(`No text layer span holding "${wanted}"`);
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, phrase);
}

test('teaches a label by highlighting it, and finds the number straight away', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);

  // "Our Ref" is not a label anything recognises, so nothing is found.
  await expect(page.getByTestId('summary')).toHaveText(
    '1 page split into 1 invoice, 1 worth a look.'
  );

  await page.getByTestId('tile-1').click();
  await highlight(page, 'Our Ref 889900');

  // The number is dropped: it changes from invoice to invoice, the label does not.
  await expect(page.getByTestId('teach-label')).toHaveText('Our Ref');

  await page.getByTestId('teach-add').click();

  await expect(page.getByTestId('teach-result')).toContainText('Found 889900 after Our Ref');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('summary')).toHaveText('1 page split into 1 invoice.');
  await expect(page.getByTestId('invoice-table')).toContainText('a label you saved');
  await expect(page.getByTestId('invoice-table')).toContainText('889900.pdf');
});

test('names a new profile after the letterhead, and switches it on', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);

  await page.getByTestId('tile-1').click();
  await highlight(page, 'Our Ref 889900');
  await page.getByTestId('teach-add').click();
  await page.keyboard.press('Escape');

  const panel = page.getByTestId('profiles-panel');
  await expect(panel).toContainText('Lucerne Publishing');
  await expect(panel).toContainText('Our Ref');
  await expect(panel.getByRole('checkbox')).toBeChecked();
});

test('splits a file holding two clients once both are taught', async ({ page }) => {
  await loadFixtures(page, ['14-two-clients.pdf']);

  // Neither client uses a label anything recognises, so it all runs together.
  await expect(page.getByTestId('summary')).toHaveText(
    '3 pages split into 1 invoice, 1 worth a look.'
  );

  await page.getByTestId('tile-1').click();
  await highlight(page, 'Our Ref NW-5501');
  await page.getByTestId('teach-add').click();
  await page.keyboard.press('Escape');

  await page.getByTestId('tile-3').click();
  await highlight(page, 'Statement Ref CS-7702');
  await expect(page.getByTestId('teach-label')).toHaveText('Statement Ref');
  await page.getByTestId('teach-profile').selectOption('new');
  await page.getByTestId('teach-add').click();
  await page.keyboard.press('Escape');

  // Each client's pages are now matched to their own profile.
  await expect(page.getByTestId('summary')).toHaveText('3 pages split into 2 invoices.');
  const table = page.getByTestId('invoice-table');
  await expect(table.getByRole('rowheader', { name: 'NW-5501' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'CS-7702' })).toBeVisible();
});

test('remembers profiles after the page is reloaded', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);
  await page.getByTestId('tile-1').click();
  await highlight(page, 'Our Ref 889900');
  await page.getByTestId('teach-add').click();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.getByTestId('profiles-panel')).toContainText('Lucerne Publishing');

  // And they are used on the next batch without anyone doing anything.
  await page.getByTestId('file-input').setInputFiles(fixture('12-unusual-label.pdf'));
  await expect(page.getByTestId('summary')).toHaveText('1 page split into 1 invoice.');
  await expect(page.getByTestId('invoice-table')).toContainText('889900.pdf');
});

test('switching a profile off puts detection back how it was', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);
  await page.getByTestId('tile-1').click();
  await highlight(page, 'Our Ref 889900');
  await page.getByTestId('teach-add').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('summary')).toHaveText('1 page split into 1 invoice.');

  await page.getByTestId('profiles-panel').getByRole('checkbox').uncheck();

  await expect(page.getByTestId('summary')).toHaveText(
    '1 page split into 1 invoice, 1 worth a look.'
  );
  await expect(page.getByTestId('review-queue')).toContainText('No invoice number was found');
});

test('a profile written by hand matches its client and names its own files', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);

  await page.getByTestId('profile-add').click();
  await page.getByTestId('profile-name').fill('Lucerne Publishing');
  await page.getByTestId('profile-identifying').fill('Lucerne Publishing');
  await page.getByTestId('profile-labels').fill('Our Ref');
  await page.getByTestId('profile-template').fill('{client}-{invoice}');
  await page.getByTestId('profile-save').click();

  await expect(page.getByTestId('profile-editor')).toBeHidden();
  await expect(page.getByTestId('invoice-table')).toContainText('Lucerne Publishing-889900.pdf');
});

test('moves profiles between computers as a JSON file', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);

  await page.getByTestId('profile-add').click();
  await page.getByTestId('profile-name').fill('Lucerne Publishing');
  await page.getByTestId('profile-identifying').fill('Lucerne Publishing');
  await page.getByTestId('profile-labels').fill('Our Ref');
  await page.getByTestId('profile-save').click();

  const waitFor = page.waitForEvent('download');
  await page.getByTestId('profile-export').click();
  const saved = await waitFor;

  expect(saved.suggestedFilename()).toBe('invoice-splitter-profiles.json');
  const written = JSON.parse(await readFile(await saved.path(), 'utf8'));
  expect(written.kind).toBe('invoice-splitter-profiles');
  expect(written.profiles).toEqual([
    expect.objectContaining({ name: 'Lucerne Publishing', labels: ['Our Ref'] }),
  ]);

  // Reading that file back on a fresh start brings the profile with it.
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('profiles-panel')).toContainText('None yet');

  await page.getByTestId('profile-import-input').setInputFiles(await saved.path());
  await expect(page.getByTestId('profiles-panel')).toContainText('Lucerne Publishing');
});

test('says plainly when an imported file is not a profiles file', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);

  // A PDF is not a profiles file, and saying so beats a stack trace.
  await page.getByTestId('profile-import-input').setInputFiles(fixture('01-same-line.pdf'));

  await expect(page.getByTestId('problems')).toContainText('not a profiles file');
});

test('deletes a profile and leaves detection as it was before', async ({ page }) => {
  await loadFixtures(page, ['12-unusual-label.pdf']);

  await page.getByTestId('tile-1').click();
  await highlight(page, 'Our Ref 889900');
  await page.getByTestId('teach-add').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('invoice-table')).toContainText('889900.pdf');

  await page.getByTestId('profiles-panel').getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('profile-delete').click();

  await expect(page.getByTestId('profiles-panel')).toContainText('None yet');
  await expect(page.getByTestId('summary')).toHaveText(
    '1 page split into 1 invoice, 1 worth a look.'
  );
});
