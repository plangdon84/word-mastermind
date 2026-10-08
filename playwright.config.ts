import { defineConfig, devices } from '@playwright/test';

/*
 * Browser tests (Dev Plan item 17, docs/test-plan.md): the app built as it
 * ships, talking to the game server running locally, in Chromium (Chrome,
 * Android) and WebKit (Safari's engine). `npm run e2e`.
 *
 * PLAYWRIGHT_CHROMIUM_PATH runs Chromium from somewhere other than
 * Playwright's own download (a cloud session's preinstalled browser).
 */

const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
export const APP_URL = 'http://localhost:4173';

export default defineConfig({
  testDir: 'e2e',
  // The screenshot gallery's index page (e2e/gallery.ts).
  globalTeardown: './e2e/gallery.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 7'], launchOptions: chromiumPath ? { executablePath: chromiumPath } : {} },
    },
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: [
    {
      command: 'node e2e/worker.ts',
      // Any answer means it's up; this one is a 400 for the missing guest ID.
      url: 'http://localhost:8787/api/daily',
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: 'vite build --outDir dist-e2e --emptyOutDir && vite preview --outDir dist-e2e --port 4173 --strictPort',
      env: { VITE_API_URL: 'http://localhost:8787' },
      url: APP_URL,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
