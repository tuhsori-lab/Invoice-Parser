/**
 * Saving invoices straight into a folder on this computer.
 *
 * Downloads land wherever the browser puts downloads, usually one folder for
 * everything. Chrome and Edge can instead let a page write into a folder the
 * person picks, which is what this uses: pick a folder, and every invoice is
 * written into it as its own PDF, with no ZIP to unpack.
 *
 * Everything stays on this computer. The browser asks the person to choose the
 * folder and to allow the page to save there; nothing is sent anywhere.
 * Browsers without the feature carry on with downloads, and the option to save
 * to a folder is simply not offered.
 */

/**
 * Remembered by the browser between visits, so the folder picker opens where
 * the last batch was saved.
 */
const PICKER_ID = 'invoice-splitter-folder';

/** Can this browser write into a folder the person picks? */
export function canSaveToFolder() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * Ask which folder to save into.
 *
 * Has to be called straight from a click: browsers only show the picker in
 * answer to something the person just did.
 *
 * @returns {Promise<FileSystemDirectoryHandle|null>} null if they closed the picker.
 */
export async function chooseFolder() {
  try {
    return await window.showDirectoryPicker({ id: PICKER_ID, mode: 'readwrite' });
  } catch (error) {
    // Closing the picker is a change of mind, not a problem.
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}

/**
 * Which of these names are already taken in the folder.
 *
 * @param {FileSystemDirectoryHandle} folder
 * @param {string[]} names
 * @returns {Promise<string[]>}
 */
export async function namesAlreadyThere(folder, names) {
  const taken = [];
  for (const name of names) {
    try {
      await folder.getFileHandle(name);
      taken.push(name);
    } catch (error) {
      if (error?.name !== 'NotFoundError' && error?.name !== 'TypeMismatchError') throw error;
    }
  }
  return taken;
}

/**
 * Write each file into the folder, replacing one of the same name.
 *
 * @param {FileSystemDirectoryHandle} folder
 * @param {Array<{ name: string, data: Uint8Array }>} files
 * @param {object} [options]
 * @param {(done: number, total: number) => void} [options.onProgress]
 */
export async function writeIntoFolder(folder, files, options = {}) {
  const { onProgress } = options;
  let done = 0;
  for (const file of files) {
    const handle = await folder.getFileHandle(file.name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(file.data);
      await writable.close();
    } catch (error) {
      // Throw the half-written file away rather than leave a broken PDF behind.
      await writable.abort?.().catch(() => {});
      throw error;
    }
    done += 1;
    onProgress?.(done, files.length);
  }
}
