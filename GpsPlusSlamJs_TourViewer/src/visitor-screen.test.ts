import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { realSeams, type TourViewerSeams } from "./seams";
import {
  locationTapNeeded,
  wireVisitorScreen,
  type LocationPermission,
  type VisitorScreenDom,
} from "./visitor-screen";

/**
 * Why these tests matter: the visitor's first tap is the one interaction a
 * passerby gets, and it has to do the right one of two things. A tap that
 * starts AR while the geolocation prompt is still to come spends the user
 * activation on the prompt and the session never starts - a failure only
 * visible on a phone. So the gate is pessimistic until the permission is
 * known granted, clears only on an obtained position, and reports a
 * refusal where the visitor is looking.
 */

function seamsWith(overrides: Partial<TourViewerSeams>): TourViewerSeams {
  return { ...realSeams, ...overrides };
}

/** Plain objects: the module's DOM surface is structural (no jsdom here). */
function dom(): VisitorScreenDom {
  return {
    screen: { hidden: false },
    creatorOnly: [{ hidden: false }, { hidden: false }],
    arHint: { textContent: "creator hint" },
    errorBox: { textContent: "" },
  };
}

describe("locationTapNeeded", () => {
  it("needs the tap for everything but a known grant (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<LocationPermission>(
          "granted",
          "prompt",
          "denied",
          "unknown",
        ),
        (permission) => {
          expect(locationTapNeeded(permission)).toBe(permission !== "granted");
        },
      ),
    );
  });
});

describe("wireVisitorScreen", () => {
  it("hides the visitor screen for a creator and leaves the gate cleared", () => {
    const d = dom();
    const screen = wireVisitorScreen({
      mode: "creator",
      seams: seamsWith({
        queryGeolocationPermission: () =>
          Promise.resolve("prompt" as LocationPermission),
      }),
      dom: d,
      renderArEntry: vi.fn(),
    });
    expect(d.screen.hidden).toBe(true);
    expect(d.creatorOnly.every((e) => !e.hidden)).toBe(true);
    expect(d.arHint.textContent).toBe("creator hint");
    expect(screen.locationGate.pending()).toBe(false);
  });

  it("shows the screen for a visitor, hides the creator's sections, and clears the gate once the permission reads granted", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("granted"),
      }),
      dom: d,
      renderArEntry,
    });
    expect(d.screen.hidden).toBe(false);
    expect(d.creatorOnly.every((e) => e.hidden)).toBe(true);
    expect(d.arHint.textContent).toContain("printed code");
    // Pessimistic before the query answers.
    expect(screen.locationGate.pending()).toBe(true);
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(false);
  });

  it("keeps the gate pending on 'prompt', clears it after a granted request, and reports a refusal", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const requestLocationOnce = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
        requestLocationOnce,
      }),
      dom: d,
      renderArEntry,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(true);

    await expect(screen.locationGate.request()).resolves.toBe(false);
    expect(screen.locationGate.pending()).toBe(true);
    expect(d.errorBox.textContent).toMatch(/allow location/i);

    await expect(screen.locationGate.request()).resolves.toBe(true);
    expect(screen.locationGate.pending()).toBe(false);
    expect(d.errorBox.textContent).toBe("");
    expect(renderArEntry).toHaveBeenCalledTimes(3);
  });
});
