import { defineConfig, devices } from '@playwright/test';
import { STATIC_PORT } from './tests/e2e/staticHost';

const PORT = 4173;

// Browser tests always run against the production build: served by `vite preview`, and by a plain static file
// server for the static-hosting tests.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run build && npm run preview',
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // A plain static file server over the same dist/ (tests/e2e/staticHost.ts), for tests/e2e/staticHost.spec.ts.
      // It reads files per request, so it may start before the build above has finished.
      command: 'node tests/e2e/staticHost.ts',
      url: `http://127.0.0.1:${STATIC_PORT}/__ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'] } },
    // Touch/mobile emulation. WebKit emulation approximates, but is not, iOS Safari.
    { name: 'phone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'tablet-webkit', use: { ...devices['iPad (gen 7)'] } },
    { name: 'phone-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'tablet-chromium', use: { ...devices['Galaxy Tab S4'] } },
  ],
});
