/**
 * Make sure the sample PDFs exist before any test runs.
 *
 * The PDFs are not committed - they are built from scripts/make-fixtures.js, so
 * that the repository never holds a file that could be mistaken for real
 * invoice data. Running the tests on a fresh clone builds them first.
 */

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURE_DIR, makeFixtures } from '../../scripts/make-fixtures.js';
import { CASES, SPECIAL_CASES } from '../fixtures/expected.js';

export default async function setup() {
  const needed = new Set([
    ...CASES.map((entry) => entry.file),
    ...Object.values(SPECIAL_CASES).map((entry) => entry.file),
  ]);

  for (const file of needed) {
    try {
      await access(join(FIXTURE_DIR, file));
    } catch {
      await makeFixtures();
      return;
    }
  }
}
