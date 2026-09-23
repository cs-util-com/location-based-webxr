// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * The 3D look-dev page's smoke test (the design system's `test:e2e` stage).
 *
 * Port 5198 is allocated in docs/dev-server-ports.md (aux range). The server
 * is NEVER reused: `pnpm run serve` for a phone round listens on 4173 on all
 * interfaces, and a smoke that attached to a stale server would test old code
 * (the port-5182 incident recorded in that file).
 *
 * One worker: headless Chromium rasterises WebGL on the CPU, and parallel
 * SwiftShader instances measure queueing, not work (lessons-learned).
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.smoke\.spec\.mjs$/,
  workers: 1,
  // A cold SwiftShader boot plus the CPU parity oracle (a few million
  // scattering evaluations) is slow by design, not by defect.
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5198",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "node serve.mjs",
    cwd: "..",
    env: { PORT: "5198", HOST: "127.0.0.1" },
    url: "http://127.0.0.1:5198/3d/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
