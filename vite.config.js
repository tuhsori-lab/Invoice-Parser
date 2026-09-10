import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is deployed to GitHub Pages under /Invoice-Parser/, but runs from / in dev.
const base = process.env.GITHUB_PAGES === 'true' ? '/Invoice-Parser/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
  // pdf.js ships its worker as a separate ES module. It is bundled from
  // node_modules (see src/lib/pdfjs.js) so nothing is ever fetched from a CDN.
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    globalSetup: ['tests/setup/fixtures.global.js'],
    testTimeout: 30000,
  },
});
