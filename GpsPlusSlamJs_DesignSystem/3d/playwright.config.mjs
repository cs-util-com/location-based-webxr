// @ts-check
import { defineConfig, devices } from "@playwright/test";

/**
 * The 3D look-dev page's smoke test and the lab pages' specs (the design
 * system's `test:e2e` stage).
 *
 * Port 5198 is allocated in docs/dev-server-ports.md (aux range). The server
 * is NEVER reused: `pnpm run serve` for a phone round listens on 4173 on all
 * interfaces, and a smoke that attached to a stale server would test old code
 * (the port-5182 incident recorded in that file).
 *
 * One worker: headless Chromium rasterises WebGL on the CPU, and parallel
 * SwiftShader instances measure queueing, not work (lessons-learned).
 *
 * `DS_E2E_PORT` overrides the port for a second checkout (a git worktree)
 * running its own smoke at the same time; the default stays the allocated
 * 5198. Still never reused, so a clash fails loudly instead of testing the
 * other checkout's code.
 */
const PORT = process.env.DS_E2E_PORT ?? "5198";
// No leading zero: the browser would normalise "05210" to 5210 while the
// globe smoke's allow-list kept ":05210" and blocked every request.
if (!/^[1-9]\d{3,4}$/.test(PORT)) {
  throw new Error(`DS_E2E_PORT must be a port number, got ${PORT}`);
}

export default defineConfig({
  // The package root, so the lab pages' specs (programme DEC-PRG-2:
  // `labs/<name>/`) run in the same stage as the main page's.
  testDir: "..",
  testMatch: ["3d/*.smoke.spec.mjs", "labs/*/*.smoke.spec.mjs"],
  workers: 1,
  // A cold SwiftShader boot plus the CPU parity oracle (a few million
  // scattering evaluations) is slow by design, not by defect.
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "node serve.mjs",
    cwd: "..",
    env: { PORT, HOST: "127.0.0.1" },
    url: `http://127.0.0.1:${PORT}/3d/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
