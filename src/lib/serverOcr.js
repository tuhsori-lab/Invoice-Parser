/**
 * Reading scanned pages with PaddleOCR on your own server instead of in the
 * browser.
 *
 * It stands in for the Tesseract scheduler in ocr.js: same call, same answer
 * (lines and words with boxes in the picture's pixels, confidence 0-100), so
 * everything Split does with a reading works unchanged. Only used in a build
 * with VITE_INVOICE_API_URL, by someone signed in on the Extract tab, and only
 * when they ask for scanned pages to be read.
 */
import { API_URL } from './apiConfig.js';

function pictureOf(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The page could not be drawn.'))),
      'image/png'
    )
  );
}

/** An engine with the shape ocr.js expects of Tesseract's: one reader, on the server. */
export function serverEngine(token) {
  return {
    count: 1,
    workers: [],
    remote: true,
    scheduler: {
      async addJob(_kind, canvas) {
        const form = new FormData();
        form.append('image', await pictureOf(canvas), 'page.png');
        let response;
        try {
          response = await fetch(`${API_URL}/ocr`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
            credentials: 'omit',
            cache: 'no-store',
          });
        } catch {
          throw new Error('your OCR server could not be reached');
        }
        if (!response.ok) {
          const detail = await response.json().then(
            (data) => data.detail,
            () => null
          );
          throw new Error(
            typeof detail === 'string' ? detail : `the server said ${response.status}`
          );
        }
        const { lines } = await response.json();
        const words = lines.flatMap((line) => line.words);
        const confidence = words.length
          ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
          : 0;
        return {
          data: { lines, words, confidence, text: lines.map((line) => line.text).join('\n') },
        };
      },
    },
  };
}
