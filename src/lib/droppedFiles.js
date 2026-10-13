/**
 * The files dropped on the page, folders and all.
 *
 * A dropped folder arrives as one entry; its files are found by walking it and
 * every folder inside it. Each file keeps the path it had inside the dropped
 * folder, so two invoices with the same name in different folders can be told
 * apart.
 */

/** Read every entry of a folder: the browser hands them over a hundred at a time. */
function readAll(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(entries);
        else {
          entries.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

/** A file entry's File, with the path it had in the dropped folder. */
function fileOf(entry) {
  return new Promise((resolve, reject) =>
    entry.file((file) => resolve({ file, path: entry.fullPath.replace(/^\//, '') }), reject)
  );
}

async function walk(entry, found) {
  if (entry.isFile) found.push(await fileOf(entry));
  else if (entry.isDirectory) {
    for (const child of await readAll(entry.createReader())) await walk(child, found);
  }
}

/**
 * @param {DataTransfer} dataTransfer - from a drop event.
 * @returns {Promise<Array<{ file: File, path: string }>>}
 */
export async function filesFromDrop(dataTransfer) {
  const entries = [...(dataTransfer?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  // A browser without folder support: the plain list of files.
  if (entries.length === 0) {
    return [...(dataTransfer?.files ?? [])].map((file) => ({ file, path: file.name }));
  }
  const found = [];
  for (const entry of entries) await walk(entry, found);
  return found;
}

/**
 * Files chosen with a file picker - one with `webkitdirectory` gives a whole
 * folder, each file with its relative path.
 *
 * @param {FileList} list
 * @returns {Array<{ file: File, path: string }>}
 */
export function filesFromInput(list) {
  return [...(list ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

/** Is this a PDF, by its type or its name? */
export function isPdfFile(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(String(file?.name ?? ''));
}
