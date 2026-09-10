import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { realSeams, type TourViewerSeams } from "./seams";
import {
  gateAfterRequest,
  locationRequestMessage,
  locationTapNeeded,
  wireVisitorScreen,
  type LocationPermission,
  type LocationRequestOutcome,
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
    measureStep: { open: false },
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
    // A creator opens step 4 by walking the setup; forcing it open here
    // would break the one-step-at-a-time rule on their very first load.
    expect(d.measureStep.open).toBe(false);
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
    // Step 4 is a <details> whose summary is creator-only, so nothing on a
    // visitor page could ever open it - and its content is their Start
    // button (M3, F4).
    expect(d.measureStep.open).toBe(true);
    expect(d.arHint.textContent).toContain("printed code");
    // Pessimistic before the query answers.
    expect(screen.locationGate.pending()).toBe(true);
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(false);
  });

  it("keeps the gate pending on 'prompt', keeps it on a DENIAL with the settings copy, clears it on a grant", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const requestLocationOnce = vi
      .fn<() => Promise<LocationRequestOutcome>>()
      .mockResolvedValueOnce("denied")
      .mockResolvedValueOnce("granted");
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

    await expect(screen.locationGate.request()).resolves.toBe("denied");
    expect(screen.locationGate.pending()).toBe(true);
    expect(d.errorBox.textContent).toMatch(/allow location/i);

    await expect(screen.locationGate.request()).resolves.toBe("granted");
    expect(screen.locationGate.pending()).toBe(false);
    expect(d.errorBox.textContent).toBe("");
  });

  it("clears the gate when the permission is fine but no fix came (M2 review #1), and shows busy while a request runs", async () => {
    // Why this matters: a visitor indoors or in a courtyard is NOT refusing
    // anything; the session's own GPS watch copes with a slow fix, and a
    // gate that locked them out with "allow location in your settings" would
    // be the worse failure.
    const d = dom();
    const renderArEntry = vi.fn();
    let settle: (o: LocationRequestOutcome) => void = () => undefined;
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
        requestLocationOnce: () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      }),
      dom: d,
      renderArEntry,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    const request = screen.locationGate.request();
    expect(screen.locationGate.busy()).toBe(true);
    settle("unavailable");
    await expect(request).resolves.toBe("unavailable");
    expect(screen.locationGate.busy()).toBe(false);
    expect(screen.locationGate.pending()).toBe(false);
    expect(d.errorBox.textContent).toMatch(/no gps fix yet/i);
  });

  it("the pure rules: only a denial keeps the gate; every outcome but a grant has a message (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<LocationRequestOutcome>(
          "granted",
          "denied",
          "unavailable",
        ),
        (outcome) => {
          expect(gateAfterRequest(outcome)).toBe(outcome === "denied");
          expect(locationRequestMessage(outcome) === "").toBe(
            outcome === "granted",
          );
        },
      ),
    );
  });
});
