/**
 * Turning problems into sentences a person can act on.
 *
 * The people using this app are not developers. "InvalidPDFException" tells them
 * nothing; "This file is damaged, so it cannot be opened" tells them what
 * happened, and the sentence after it tells them what to do next.
 */

/** Problems this app knows how to explain, and what to say about them. */
export const MESSAGES = {
  'password-protected': {
    what: 'This PDF is password-protected.',
    next: 'Save a copy without the password and try again.',
  },
  damaged: {
    what: 'This PDF could not be read. The file looks damaged.',
    next: 'Try opening it in your PDF reader and saving a fresh copy.',
  },
  'no-text': {
    what: 'No readable text was found. These look like scanned pages.',
    next: 'Turn on text recognition to read them.',
  },
  'not-a-pdf': {
    what: 'This file is not a PDF.',
    next: 'Choose a file ending in .pdf.',
  },
  cancelled: {
    what: 'Reading was stopped.',
    next: 'Nothing was saved. You can start again whenever you like.',
  },
  unknown: {
    what: 'Something went wrong while reading this file.',
    next: 'Try again, or try a different copy of the file.',
  },
};

/**
 * Work out which problem an error from pdf.js describes.
 *
 * @param {Error|{ name?: string, message?: string }} error
 * @returns {keyof MESSAGES}
 */
export function classifyError(error) {
  const name = error?.name ?? '';
  const message = String(error?.message ?? '');

  if (name === 'PasswordException' || /password/i.test(message)) return 'password-protected';
  if (name === 'InvalidPDFException' || /invalid pdf|structure/i.test(message)) return 'damaged';
  if (/not a pdf|unsupported file/i.test(message)) return 'not-a-pdf';
  if (name === 'AbortException' || /abort|cancel/i.test(message)) return 'cancelled';
  return 'unknown';
}

/**
 * A full sentence pair for a problem, ready to show.
 *
 * @param {keyof MESSAGES|Error} problem - a key, or an error to classify first.
 * @param {object} [context]
 * @param {string} [context.fileName] - named in the message when it is known.
 * @returns {{ kind: string, what: string, next: string, text: string }}
 */
export function explain(problem, context = {}) {
  const kind = typeof problem === 'string' ? problem : classifyError(problem);
  const message = MESSAGES[kind] ?? MESSAGES.unknown;
  const what = context.fileName ? `${context.fileName}: ${message.what}` : message.what;
  return { kind, what, next: message.next, text: `${what} ${message.next}` };
}
