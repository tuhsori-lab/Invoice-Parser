import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real built app in a real browser, because
 * the things worth checking here - a PDF being read, a file being downloaded -
 * only exist in a browser.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // The built app, served the way it is served in production.
  //
  // The host is given outright rather than left to default to "localhost".
  // Node stopped putting IPv4 first when resolving that name, so on a machine
  // where localhost is ::1 the server binds to IPv6 while the line below waits
  // on IPv4, and nothing ever answers. Naming the same address in both places
  // leaves nothing to resolve.
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
