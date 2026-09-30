/**
 * Saving every invoice straight into a folder the person picks.
 *
 * The real folder picker is a window of the operating system's, which no test
 * can click through. So these stand it in with a folder in the browser's own
 * private storage: a real folder handle, written to by the same calls the app
 * makes on a real disk, and read back afterwards to see what landed in it.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(HERE, '..', 'fixtures', 'pdf', name);

const FOLDER = 'Chosen folder';

async function loadFixtures(page, names) {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles(names.map(fixture));
  await expect(page.getByTestId('page-strip')).toBeVisible();
}

/** Answer the folder picker with a folder in the browser's private storage. */
async function pickerChooses(page, folderName = FOLDER) {
  await page.addInitScript((name) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle(name, { create: true });
    };
  }, folderName);
}

/** Every file in that folder, by name, with its bytes. */
async function filesIn(page, folderName = FOLDER) {
  const files = await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle(name, { create: true });
    const found = {};
    for await (const [entry, handle] of folder.entries()) {
      const file = await handle.getFile();
      found[entry] = Array.from(new Uint8Array(await file.arrayBuffer()));
    }
    return found;
  }, folderName);
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, Uint8Array.from(bytes)])
  );
}

/** Put a file in the folder before the app gets there. */
async function alreadyInFolder(page, fileName, text, folderName = FOLDER) {
  await page.evaluate(
    async ([name, file, contents]) => {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle(name, { create: true });
      const handle = await folder.getFileHandle(file, { create: true });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
    },
    [folderName, fileName, text]
  );
}

test('saves every invoice into the chosen folder, one PDF each', async ({ page }) => {
  await pickerChooses(page);
  await loadFixtures(page, ['21-column-heading.pdf']);

  await page.getByTestId('save-folder').click();
  await expect(page.getByTestId('saved-to')).toHaveText('Saved 2 invoices to “Chosen folder”.');

  const files = await filesIn(page);
  expect(Object.keys(files).sort()).toEqual(['SR-40881_2.pdf', 'SR-40997_1.pdf']);
  for (const bytes of Object.values(files)) {
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  }
});

test('asks before replacing a file of the same name', async ({ page }) => {
  await pickerChooses(page);
  await loadFixtures(page, ['21-column-heading.pdf']);
  await alreadyInFolder(page, 'SR-40881_2.pdf', 'an older file');

  await page.getByTestId('save-folder').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    'SR-40881_2.pdf is already in “Chosen folder”. Replace it?'
  );

  // Saying no leaves the folder exactly as it was.
  await page.getByRole('button', { name: 'Cancel' }).click();
  let files = await filesIn(page);
  expect(Object.keys(files)).toEqual(['SR-40881_2.pdf']);
  expect(new TextDecoder().decode(files['SR-40881_2.pdf'])).toBe('an older file');

  await page.getByTestId('save-folder').click();
  await page.getByRole('button', { name: 'Replace it' }).click();
  await expect(page.getByTestId('saved-to')).toHaveText('Saved 2 invoices to “Chosen folder”.');

  files = await filesIn(page);
  expect(Object.keys(files).sort()).toEqual(['SR-40881_2.pdf', 'SR-40997_1.pdf']);
  expect(new TextDecoder().decode(files['SR-40881_2.pdf'].slice(0, 5))).toBe('%PDF-');
});

test('gives the same warning as the ZIP when invoices still need a look', async ({ page }) => {
  await pickerChooses(page);
  await loadFixtures(page, ['22-boxed-number.pdf']);
  await page.getByTestId('point-prompt-dismiss').click();

  await page.getByTestId('save-folder').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    '1 invoice still needs a look. Export anyway?'
  );
  await page.getByRole('button', { name: 'Export anyway' }).click();

  await expect(page.getByTestId('saved-to')).toHaveText('Saved 1 invoice to “Chosen folder”.');
  expect(Object.keys(await filesIn(page))).toEqual(['NO-NUMBER_p1-4.pdf']);
});

test('closing the folder picker changes nothing', async ({ page }) => {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    };
  });
  await loadFixtures(page, ['21-column-heading.pdf']);

  await page.getByTestId('save-folder').click();

  await expect(page.getByTestId('save-folder')).toHaveText('Save to a folder…');
  await expect(page.getByTestId('saved-to')).toHaveCount(0);
  await expect(page.getByTestId('problems')).toHaveCount(0);
});

test('is not offered by a browser that cannot save into a folder', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
  });
  await loadFixtures(page, ['21-column-heading.pdf']);

  await expect(page.getByTestId('save-folder')).toHaveCount(0);
  await expect(page.getByTestId('download-zip')).toBeVisible();
});
