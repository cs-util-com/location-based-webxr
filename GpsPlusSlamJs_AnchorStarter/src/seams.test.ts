import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnchorStarterSeams } from "./seams.js";

/**
 * Prod-inert guarantee for the DEV-only `window.__anchorStarterSeams` override
 * (see GpsPlusSlamJs_Docs/docs/2026-06-01-0447-anchor-starter-e2e-test-plan.md §5/§8).
 *
 * Why this test matters: the seam exists solely so the Playwright e2e suite can
 * inject AR/GPS fakes. It must NEVER swap behaviour for real users. The guard is
 * `import.meta.env.DEV && !import.meta.env.VITEST`, so:
 *   - with no override present, `getSeams()` must hand back the real imports; and
 *   - even with an override installed, it must be IGNORED here (because the
 *     suite runs under `VITEST`), mirroring how a production build — where
 *     `import.meta.env.DEV` is statically `false` — strips the branch entirely.
 * If either invariant breaks, a misconfigured or malicious `window` global could
 * silently replace the app's AR/GPS functions, which this test forbids.
 *
 * The framework barrels are mocked because they transitively load Leaflet, which
 * touches `window` at import time and crashes in the default node test env. The
 * guard logic under test is independent of *what* the seams are — the real
 * framework wiring is exercised by the Tier 1 e2e suite in a browser. Mocking
 * keeps this a fast, deterministic node unit test focused purely on the guard.
 */
vi.mock("gps-plus-slam-app-framework/state", () => ({
  selectTrackingQuality: () => null,
  selectAlignmentMatrix: () => null,
}));
vi.mock("gps-plus-slam-app-framework/ar/webxr-session", () => ({
  initAR: () => Promise.resolve(),
  endARSession: () => Promise.resolve(),
  getArWorldGroup: () => null,
  getCamera: () => null,
}));
vi.mock("gps-plus-slam-app-framework/ar/xr-frame-loop", () => ({
  registerXrFrameUpdate: () => () => undefined,
}));
vi.mock("gps-plus-slam-app-framework/sensors", () => ({
  startGpsWatch: () => undefined,
  startOrientationWatch: () => undefined,
  requestDeviceOrientationPermission: () => Promise.resolve(),
  checkWebXRSupport: () => Promise.resolve({ supported: false }),
  checkGeolocationPermission: () => Promise.resolve({ supported: false }),
}));
vi.mock("gps-plus-slam-app-framework/visualization", () => ({
  createGpsAnchor: () => ({ dispose: () => undefined }),
  createWayfindingHud: () => ({ dispose: () => undefined }),
  enableArWorldGroupAlignment: () => ({ dispose: () => undefined }),
  createReticleMesh: () => ({ visible: false }),
  updateReticle: () => undefined,
}));

const { getSeams, realSeams } = await import("./seams.js");

describe("getSeams — prod-inert override guard", () => {
  afterEach(() => {
    // Never leak the synthesised window/override across tests.
    delete (globalThis as { window?: unknown }).window;
  });

  it("guard is anchored on VITEST being set in this environment", () => {
    // Documents the basis of the guard: the override is ignored below precisely
    // because the suite runs under Vitest. A production build relies instead on
    // `import.meta.env.DEV === false` to strip the branch.
    expect(import.meta.env.VITEST).toBeTruthy();
  });

  it("returns the real framework imports when no override is set", () => {
    expect(getSeams()).toBe(realSeams);
  });

  it("ignores a window override under VITEST (production strips it entirely)", () => {
    const tamper: Partial<AnchorStarterSeams> = {
      initAR: () => Promise.reject(new Error("tampered")),
    };
    // `window` is absent in the default node environment — synthesise just
    // enough to install the override the guard would read in DEV.
    (globalThis as { window?: Partial<Window> }).window = {
      __anchorStarterSeams: tamper,
    };

    // The guard's `!import.meta.env.VITEST` term is false here, so the override
    // must be ignored and the real imports returned unchanged.
    expect(getSeams()).toBe(realSeams);
    expect(getSeams().initAR).not.toBe(tamper.initAR);
  });
});
