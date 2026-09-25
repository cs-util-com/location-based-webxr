/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestWakeLock } from "./wake-lock.js";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "wakeLock");
});

function installFakeWakeLock() {
  const release = vi.fn().mockResolvedValue(undefined);
  const sentinel = {
    release,
    released: false,
    addEventListener: vi.fn(),
  };
  const request = vi.fn().mockResolvedValue(sentinel);
  Object.defineProperty(navigator, "wakeLock", {
    value: { request },
    configurable: true,
  });
  return { request, release, sentinel };
}

describe("requestWakeLock", () => {
  it("requests a screen wake lock when supported", async () => {
    const { request } = installFakeWakeLock();

    await requestWakeLock();

    expect(request).toHaveBeenCalledWith("screen");
  });

  it("release() releases the underlying sentinel", async () => {
    const { release } = installFakeWakeLock();

    const handle = await requestWakeLock();
    handle.release();
    await Promise.resolve();

    expect(release).toHaveBeenCalledOnce();
  });

  it("is a non-fatal no-op when navigator.wakeLock is unsupported", async () => {
    Reflect.deleteProperty(navigator, "wakeLock");

    const handle = await requestWakeLock();

    expect(() => handle.release()).not.toThrow();
  });

  it("is a non-fatal no-op when the request rejects", async () => {
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    const handle = await requestWakeLock();

    expect(() => handle.release()).not.toThrow();
  });
});
