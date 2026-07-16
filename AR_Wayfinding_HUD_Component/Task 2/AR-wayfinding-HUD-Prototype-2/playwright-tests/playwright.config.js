import { defineConfig, devices } from '@playwright/test';

const captureArtifacts = process.env.PLAYWRIGHT_CAPTURE === '1';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: process.env.CI
    ? [
        ['github'],
        ['json', { outputFile: '../test-results.json' }],
        ['junit', { outputFile: '../junit.xml' }],
      ]
    : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: captureArtifacts ? 'on' : 'on-first-retry',
    screenshot: captureArtifacts ? 'on' : 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'VITE_DISABLE_MKCERT=1 npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
