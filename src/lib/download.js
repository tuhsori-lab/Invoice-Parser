/**
 * Handing a finished file to the browser.
 *
 * Everything here is local: a blob made in this tab, a link clicked in this tab.
 * No request goes anywhere.
 */

/**
 * Save some bytes under a name.
 *
 * @param {Blob|Uint8Array|string} contents
 * @param {string} fileName
 * @param {string} [type] - used when contents are not already a Blob.
 */
export function saveFile(contents, fileName, type = 'application/octet-stream') {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
