import { describe, expect, it, vi } from "vitest";

import { locationPermissionWithoutFix } from "./location-permission";

/**
 * Why these tests matter (QR-first M1b-1 review #1): the framework's
 * `enable()` asks for the location by fetching a FIX (high accuracy, no
 * cache, 10 s) and fails unless that fix arrives. Indoors a visitor who had
 * ALLOWED location got no fix, `enable()` failed, and the page said "AR
 * could not start. Tap Try again." forever - worse off than one who had
 * declined (codes alone, M1b-1). The permission is what `enable()` must
 * settle, not a fix: the session's own watch copes with a late one, and a
 * scanned code places the tour meanwhile (M1).
 */
describe("locationPermissionWithoutFix", () => {
  it("answers a granted permission at once, without fetching a fix", async () => {
    const request = vi.fn();
    const ask = locationPermissionWithoutFix({
      query: () => Promise.resolve("granted"),
      request,
    });
    await expect(ask()).resolves.toEqual({ supported: true, granted: true });
    expect(request).not.toHaveBeenCalled();
  });

  it("treats a position that did not come (timeout, unavailable) as granted", async () => {
    const ask = locationPermissionWithoutFix({
      query: () => Promise.resolve("prompt"),
      request: () =>
        Promise.resolve({
          supported: true,
          granted: null,
          error: "Location request timed out. Please try again.",
        }),
    });
    await expect(ask()).resolves.toEqual({ supported: true, granted: true });
  });

  it("passes a refusal and a missing Geolocation API through", async () => {
    const refused = {
      supported: true,
      granted: false,
      error: "Location access denied. Please enable in browser settings.",
    };
    await expect(
      locationPermissionWithoutFix({
        query: () => Promise.resolve("denied"),
        request: () => Promise.resolve(refused),
      })(),
    ).resolves.toEqual(refused);
    const noApi = {
      supported: false,
      granted: null,
      error: "Geolocation API not available in this browser.",
    };
    await expect(
      locationPermissionWithoutFix({
        query: () => Promise.resolve("unknown"),
        request: () => Promise.resolve(noApi),
      })(),
    ).resolves.toEqual(noApi);
  });

  // Why: a creator's failed start blames the location only when its own
  // request was refused; a permission read denied cannot say that, since
  // it stays denied after a refusal in an earlier visit.
  it("tells of a refusal, and of nothing else", async () => {
    const onRefused = vi.fn();
    const answers = [
      { supported: true, granted: true },
      { supported: true, granted: null },
      { supported: false, granted: null },
      { supported: true, granted: false },
    ];
    for (const answer of answers) {
      await locationPermissionWithoutFix({
        query: () => Promise.resolve("prompt"),
        request: () => Promise.resolve(answer),
        onRefused,
      })();
    }
    await locationPermissionWithoutFix({
      query: () => Promise.resolve("granted"),
      request: () => Promise.resolve({ supported: true, granted: false }),
      onRefused,
    })();
    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it("falls back to the request when the query throws", async () => {
    const request = vi.fn(() =>
      Promise.resolve({ supported: true, granted: true }),
    );
    const ask = locationPermissionWithoutFix({
      query: () => Promise.reject(new Error("no permissions API")),
      request,
    });
    await expect(ask()).resolves.toEqual({ supported: true, granted: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
