import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { realSeams, type TourViewerSeams } from "./seams";
import {
  CODES_ONLY_HINT,
  codesOnlyAfterRequest,
  locationRequestNotice,
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
    more: { hidden: false },
    measureStep: { open: false },
    creatorOnly: [{ hidden: false }, { hidden: false }],
    arHint: { textContent: "creator hint" },
    errorBox: { textContent: "" },
  };
}

describe("locationTapNeeded", () => {
  it("needs the tap while the browser may still ask: prompt and unknown (property)", () => {
    // A denied site never asks again: since QR-first M1b-1 its tap starts
    // the tour on codes alone instead of asking for nothing.
    fc.assert(
      fc.property(
        fc.constantFrom<LocationPermission>(
          "granted",
          "prompt",
          "denied",
          "unknown",
        ),
        (permission) => {
          expect(locationTapNeeded(permission)).toBe(
            permission === "prompt" || permission === "unknown",
          );
        },
      ),
    );
  });
});

describe("wireVisitorScreen", () => {
  it("says what the first tap does once the browser will ask (polish round M4a, V4)", async () => {
    // Why: V4's line under the "1 of 2" button tells the visitor the
    // browser's question is coming and what to answer; a visitor whose
    // location is already allowed keeps the line about the code.
    const d = dom();
    const renderArEntry = vi.fn();
    wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
      }),
      dom: d,
      renderArEntry,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(d.arHint.textContent).toBe(
      "Your browser will ask for your location - tap Allow. Then Start the tour.",
    );
    // A blocked site: the browser will NOT ask, so the line stays.
    const blocked = dom();
    const render = vi.fn();
    wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("denied"),
      }),
      dom: blocked,
      renderArEntry: render,
    });
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    // ...and says what a tour without location needs (QR-first M1b-1).
    expect(blocked.arHint.textContent).toBe(CODES_ONLY_HINT);
  });

  // Why (QR-first plan 2026-10-14-0445 §7 #10, §8 Q-QF-1; M1b-1): a visitor
  // who declines location used to end at "allow location in your browser
  // settings" with no way into the tour, though the tour's printed codes
  // can place it (M1). A denial - asked now, or a site blocked before - lets
  // the next tap start the tour on codes alone, and the line says what that
  // needs; it is no error, so the red alert stays empty.
  it("starts on codes alone after a denial: the gate clears, codes-only is on, and the line says to scan a code", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
        requestLocationOnce: () => Promise.resolve("denied"),
      }),
      dom: d,
      renderArEntry,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.codesOnly()).toBe(false);
    await expect(screen.locationGate.request()).resolves.toBe("denied");
    expect(screen.locationGate.pending()).toBe(false);
    expect(screen.locationGate.codesOnly()).toBe(true);
    expect(d.errorBox.textContent).toBe("");
    expect(d.arHint.textContent).toBe(CODES_ONLY_HINT);
    expect(CODES_ONLY_HINT).toBe(
      "Scan one of the tour's printed codes to start - without location, the codes place the tour.",
    );
  });

  it("starts on codes alone on a site whose location is already blocked, without a location tap", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const requestLocationOnce = vi.fn();
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("denied"),
        requestLocationOnce,
      }),
      dom: d,
      renderArEntry,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(false);
    expect(screen.locationGate.codesOnly()).toBe(true);
    expect(requestLocationOnce).not.toHaveBeenCalled();
  });

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
    expect(d.more.hidden).toBe(true);
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
    // "What happens?" and the way to make a tour (polish round M4a, V4).
    expect(d.more.hidden).toBe(false);
    expect(d.creatorOnly.every((e) => e.hidden)).toBe(true);
    // Step 4 is a <details> whose summary is creator-only, so nothing on a
    // visitor page could ever open it - and its content is their Start
    // button (M3, F4).
    expect(d.measureStep.open).toBe(true);
    expect(d.arHint.textContent).toContain("the tour's code (on the poster)");
    // V4's one line under the button: the rest is behind "What happens?".
    // (This visitor's permission is still unknown: the generic line.)
    expect(d.arHint.textContent.length).toBeLessThanOrEqual(80);
    // Pessimistic before the query answers.
    expect(screen.locationGate.pending()).toBe(true);
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(false);
  });

  it("keeps the gate pending on 'prompt' and clears it on a grant, codes-only off", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const requestLocationOnce = vi
      .fn<() => Promise<LocationRequestOutcome>>()
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

    await expect(screen.locationGate.request()).resolves.toBe("granted");
    expect(screen.locationGate.pending()).toBe(false);
    expect(screen.locationGate.codesOnly()).toBe(false);
    expect(d.errorBox.textContent).toBe("");
    // The silent second tap (UI round 1, U1, review F11): the hint now
    // says what the button just turned into.
    expect(d.arHint.textContent).toBe(
      "Location allowed - now tap Start the tour, then point your phone at the tour's code (on the poster).",
    );
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
    // The permission is fine: GPS stays on, the codes are no substitute.
    expect(screen.locationGate.codesOnly()).toBe(false);
    // A benign note, not an error: the hint, never the red alert box
    // (UI round 1, U1, review F11).
    expect(d.errorBox.textContent).toBe("");
    expect(d.arHint.textContent).toMatch(/no gps fix yet/i);
  });

  it("the pure rules: only a denial turns codes-only on; no outcome is an error any more; each says what next (property)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<LocationRequestOutcome>(
          "granted",
          "denied",
          "unavailable",
        ),
        (outcome) => {
          expect(codesOnlyAfterRequest(outcome)).toBe(outcome === "denied");
          const notice = locationRequestNotice(outcome);
          expect(notice.error).toBe("");
          expect(notice.hint.length).toBeGreaterThan(0);
        },
      ),
    );
  });
});
