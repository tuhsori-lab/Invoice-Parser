/**
 * Error messages are part of the product.
 *
 * Every message has to say what happened and what to do next, in words that
 * mean something to someone in an accounts department.
 */

import { describe, expect, it } from 'vitest';
import { classifyError, explain, MESSAGES } from '../../src/core/errors.js';

describe('working out what went wrong', () => {
  it('recognises a file that needs a password', () => {
    expect(classifyError({ name: 'PasswordException', message: 'No password given' })).toBe(
      'password-protected'
    );
  });

  it('recognises a damaged file', () => {
    expect(classifyError({ name: 'InvalidPDFException', message: 'bad XRef' })).toBe('damaged');
  });

  it('recognises a cancelled job', () => {
    expect(classifyError({ name: 'AbortException', message: 'Worker was destroyed' })).toBe(
      'cancelled'
    );
  });

  it('has something to say about anything else', () => {
    expect(classifyError(new Error('who knows'))).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
  });
});

describe('what the person reads', () => {
  it('says what happened and what to do next', () => {
    const message = explain({ name: 'PasswordException' });

    expect(message.text).toBe(
      'This PDF is password-protected. Save a copy without the password and try again.'
    );
  });

  it('names the file when it is known', () => {
    const message = explain('damaged', { fileName: 'january-batch.pdf' });

    expect(message.what).toMatch(/^january-batch\.pdf: /);
  });

  it('offers text recognition when a file turns out to be scans', () => {
    expect(explain('no-text').text).toBe(
      'No readable text was found. These look like scanned pages. Turn on text recognition to read them.'
    );
  });

  it('never leaves a person without a next step', () => {
    for (const [kind, message] of Object.entries(MESSAGES)) {
      expect(message.what, `${kind} says what happened`).toMatch(/\.$/);
      expect(message.next, `${kind} says what to do next`).toMatch(/\.$/);
      expect(message.what, `${kind} avoids jargon`).not.toMatch(/exception|error code|null/i);
    }
  });
});
