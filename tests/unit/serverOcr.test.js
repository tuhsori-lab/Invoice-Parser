import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/apiConfig.js', () => ({ API_URL: 'https://ocr.example/api' }));
const { serverEngine } = await import('../../src/lib/serverOcr.js');

const canvas = { toBlob: (done) => done(new Blob(['png'], { type: 'image/png' })) };

afterEach(() => vi.unstubAllGlobals());

describe('reading scanned pages on your own server', () => {
  it('sends the picture with the token and answers in the shape Tesseract would', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        rotation: 0,
        lines: [
          {
            text: 'Invoice No: 7730501',
            confidence: 98,
            bbox: { x0: 10, y0: 5, x1: 200, y1: 25 },
            words: [
              { text: 'Invoice', confidence: 98, bbox: { x0: 10, y0: 5, x1: 70, y1: 25 } },
              { text: '7730501', confidence: 96, bbox: { x0: 130, y0: 5, x1: 200, y1: 25 } },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetch);

    const { data } = await serverEngine('secret').scheduler.addJob('recognize', canvas);
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('https://ocr.example/api/ocr');
    expect(request.headers.Authorization).toBe('Bearer secret');
    expect(request.credentials).toBe('omit');
    expect(data.text).toBe('Invoice No: 7730501');
    expect(data.words.map((word) => word.text)).toEqual(['Invoice', '7730501']);
    expect(data.confidence).toBe(97);
  });

  it('says why when the server will not read it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 504,
        json: async () => ({ detail: 'No OCR worker answered.' }),
      }))
    );
    await expect(serverEngine('t').scheduler.addJob('recognize', canvas)).rejects.toThrow(
      'No OCR worker answered.'
    );
  });

  it('says so when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline')))
    );
    await expect(serverEngine('t').scheduler.addJob('recognize', canvas)).rejects.toThrow(
      'could not be reached'
    );
  });
});
