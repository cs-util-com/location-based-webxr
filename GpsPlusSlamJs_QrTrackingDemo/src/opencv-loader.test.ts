/**
 * OpenCV.js loader — unit tests.
 *
 * The real WASM load is device/runtime-only (verified manually, like the rest of
 * the demo's device seam). These tests pin the PURE orchestration that does not
 * need opencv.js: single-flight idempotency, the injected script loader, the
 * ready/`onRuntimeInitialized`/thenable handshakes, the timeout, and retry after
 * failure. Everything device-specific is faked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadOpenCv,
  resetOpenCvLoaderForTest,
  DEFAULT_OPENCV_URL,
} from "./opencv-loader";

beforeEach(() => resetOpenCvLoaderForTest());

/** A fake `cv` whose runtime is already initialized (`Mat` present). */
const readyCv = () => ({ Mat: class {}, CV_64F: 6, SOLVEPNP_IPPE_SQUARE: 7 });

describe("loadOpenCv", () => {
  it("loads the default URL and returns the ready global", async () => {
    const loadScript = vi.fn().mockResolvedValue(undefined);
    const cv = readyCv();
    const result = await loadOpenCv({ loadScript, getGlobal: () => cv });
    expect(loadScript).toHaveBeenCalledWith(DEFAULT_OPENCV_URL);
    expect(result).toBe(cv);
  });

  it("is single-flight: concurrent + repeat calls share one script load", async () => {
    const loadScript = vi.fn().mockResolvedValue(undefined);
    const cv = readyCv();
    const deps = { loadScript, getGlobal: () => cv };
    const [a, b] = await Promise.all([loadOpenCv(deps), loadOpenCv(deps)]);
    const c = await loadOpenCv(deps);
    expect(a).toBe(cv);
    expect(b).toBe(cv);
    expect(c).toBe(cv);
    expect(loadScript).toHaveBeenCalledTimes(1);
  });

  it("waits for onRuntimeInitialized when the runtime is not ready at load", async () => {
    const cv: { Mat?: unknown; onRuntimeInitialized?: () => void } = {};
    const promise = loadOpenCv({
      loadScript: () => Promise.resolve(),
      getGlobal: () => cv,
    });
    // Not resolved yet — the WASM runtime hasn't called back.
    let settled = false;
    void promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    // Emscripten fires the hook once the runtime is up.
    cv.Mat = class {};
    cv.onRuntimeInitialized?.();
    await expect(promise).resolves.toBe(cv);
  });

  it("supports the thenable-cv build (cv resolves to the module)", async () => {
    const module = readyCv();
    const thenable = { then: (cb: (m: unknown) => void) => cb(module) };
    const result = await loadOpenCv({
      loadScript: () => Promise.resolve(),
      getGlobal: () => thenable,
    });
    expect(result).toBe(module);
  });

  it("rejects (and allows retry) when the script fails to load", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("network"));
    await expect(
      loadOpenCv({ loadScript: failing, getGlobal: () => readyCv() }),
    ).rejects.toThrow("network");
    // After a failure the cache is cleared, so a later call retries the load.
    const ok = vi.fn().mockResolvedValue(undefined);
    const cv = readyCv();
    await expect(
      loadOpenCv({ loadScript: ok, getGlobal: () => cv }),
    ).resolves.toBe(cv);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("rejects when the global cv is never published", async () => {
    await expect(
      loadOpenCv({
        loadScript: () => Promise.resolve(),
        getGlobal: () => undefined,
      }),
    ).rejects.toThrow("no global");
  });

  it("times out if the runtime never initializes", async () => {
    // Script loads, global is published, but `Mat` never appears and
    // onRuntimeInitialized is never called → the short timeout trips.
    const cv: { Mat?: unknown; onRuntimeInitialized?: () => void } = {};
    await expect(
      loadOpenCv({
        loadScript: () => Promise.resolve(),
        getGlobal: () => cv,
        timeoutMs: 5,
      }),
    ).rejects.toThrow("did not initialize");
  });
});
