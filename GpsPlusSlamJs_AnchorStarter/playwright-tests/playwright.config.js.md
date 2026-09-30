# `playwright.config.js` — anchor-starter e2e config

- **Purpose:** Playwright runner config for the persistent-anchor starter's
  end-to-end tests. Currently scopes the **Tier 0** smoke + capability-gate
  suite (see
  [2026-06-01-0447-anchor-starter-e2e-test-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md)).
- **Key settings:**
  - `testDir: '.'` — specs live next to this config in `playwright-tests/`.
  - **Chromium only** — WebXR is Chrome-focused; other engines add no signal.
  - Chromium is launched with `browserLaunchArgs(process.env)` from `scripts/e2e/browser-launch.mjs`: `--in-process-gpu` when run-stage lowered the browser stage (Windows), so the WebGL work inherits the lowered priority; nothing otherwise.
  - `baseURL: http://127.0.0.1:5181` — the starter's dedicated dev port, kept
    distinct from the minimal example (5180) and recorder (5173).
  - `webServer.command: pnpm run dev -- --port 5181` with
    `reuseExistingServer` locally; the `test:e2e` script runs
    `build:framework` first so Vite serves a **fresh** framework `dist/`
    (the `exports` field resolves the framework to `dist/`, not source).
  - `use.permissions: ['clipboard-read','clipboard-write']` — granted up front
    so the later Tier 1 copy-link tests can exercise the clipboard.
  - Artifacts (trace/screenshot/video) on failure by default; force all on with
    `PLAYWRIGHT_CAPTURE=1`.
- **Invariants & assumptions:** Tier 0 needs **no** browser-API mock — real
  Chromium genuinely lacks `navigator.xr`, which is exactly the capability-gate
  state under test. CI tightens `forbidOnly`, adds retries, and serialises
  workers.
- **Run:** `pnpm run test:e2e` (never call `playwright` directly, per repo
  rules). `:headed` / `:ui` variants exist for debugging.
- **Tests:** drives [smoke.spec.js](smoke.spec.js).
