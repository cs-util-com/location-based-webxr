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
    // Env vars must go through `env`, not a POSIX `VAR=x` prefix — the prefix
    // form breaks when Playwright spawns the server through cmd.exe on Windows.
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    env: { VITE_DISABLE_MKCERT: '1' },
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
