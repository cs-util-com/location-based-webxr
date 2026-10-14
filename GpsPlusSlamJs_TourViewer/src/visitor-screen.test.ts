import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { realSeams, type TourViewerSeams } from "./seams";
import {
  CODES_ONLY_HINT,
  tourCodesUsable,
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

// Why (M1b-1 review #2): on a tour none of whose codes can place it, codes
// alone cannot help, so a denial keeps the old copy - allow location in
// the settings - instead of a codes-only start that would hang.
describe("a denial on a tour without a usable code keeps the settings copy (M1b-1 review #2)", () => {
  it("keeps the gate on a denial and shows the settings copy", async () => {
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
      codesUsable: () => false,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    await screen.locationGate.request();
    expect(screen.locationGate.pending()).toBe(true);
    expect(screen.locationGate.codesOnly()).toBe(false);
    expect(d.errorBox.textContent).toMatch(/allow location/i);
  });

  it("turns a blocked site's start back into a location tap once the codes are known unusable", async () => {
    let usable: boolean | null = null;
    const renderArEntry = vi.fn();
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("denied"),
      }),
      dom: dom(),
      renderArEntry,
      codesUsable: () => usable,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(false);
    usable = false;
    expect(screen.locationGate.pending()).toBe(true);
    expect(screen.locationGate.codesOnly()).toBe(false);
  });
});

// Why (M1b-1 review #3): Chrome reports a DISMISSED prompt as a denial while
// the permission stays "prompt", and a grant made later in the settings was
// never noticed - one dismissal meant no GPS for the whole page load. Before
// a codes-only start the permission is read again: granted starts with GPS,
// "prompt" offers the location once more (once: a visitor who dismisses it
// again starts on codes, never loops).
describe("the permission is read again before a codes-only start (M1b-1 review #3)", () => {
  it("starts with GPS when the permission now reads granted", async () => {
    let permission: LocationPermission = "prompt";
    const renderArEntry = vi.fn();
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve(permission),
        requestLocationOnce: () => Promise.resolve("denied"),
      }),
      dom: dom(),
      renderArEntry,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    await screen.locationGate.request();
    expect(screen.locationGate.codesOnly()).toBe(true);
    permission = "granted";
    await screen.locationGate.recheck();
    expect(screen.locationGate.codesOnly()).toBe(false);
    expect(screen.locationGate.pending()).toBe(false);
  });

  it("offers the location once more after a dismissed prompt, then starts on codes", async () => {
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
    await screen.locationGate.request();
    await screen.locationGate.recheck();
    expect(screen.locationGate.pending()).toBe(true);
    expect(screen.locationGate.codesOnly()).toBe(false);
    expect(d.arHint.textContent).toMatch(/browser will ask/i);
    // Dismissed again: codes alone, and no further offer.
    await screen.locationGate.request();
    await screen.locationGate.recheck();
    expect(screen.locationGate.pending()).toBe(false);
    expect(screen.locationGate.codesOnly()).toBe(true);
  });
});

// Why (r857 milestone review #2): `main.ts` calls `tourChanged()` on every
// manifest settle, and on a slow archive that comes AFTER the visitor
// answered the location question. The line the answer wrote must survive
// it - "your browser will ask" after an answer was the M4 review #3 defect.
describe("the line an answer wrote survives a tour change (r857 review #2)", () => {
  it("keeps the codes-only line after a denial when the tour's file settles", async () => {
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
    await screen.locationGate.request();
    expect(d.arHint.textContent).toBe(CODES_ONLY_HINT);
    screen.tourChanged();
    expect(d.arHint.textContent).toBe(CODES_ONLY_HINT);
  });

  it("keeps the 'location allowed' line after a grant when the tour's file settles", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
        requestLocationOnce: () => Promise.resolve("granted"),
      }),
      dom: d,
      renderArEntry,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    await screen.locationGate.request();
    const answered = locationRequestNotice("granted").hint;
    expect(d.arHint.textContent).toBe(answered);
    screen.tourChanged();
    expect(d.arHint.textContent).toBe(answered);
  });

  it("keeps the plain line of a denial on a tour whose codes cannot place it when the tour's file settles", async () => {
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
      codesUsable: () => false,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    await screen.locationGate.request();
    expect(d.arHint.textContent).not.toMatch(/browser will ask/i);
    screen.tourChanged();
    expect(d.arHint.textContent).not.toMatch(/browser will ask/i);
  });
});

// Why (owner decision Q-QF-1, the per-tour half): a creator can mark a tour
// "needs no GPS" (`tour.json` `needsNoGps`). Its visitor is never asked for
// the location: the button starts the tour at once, on codes alone, and the
// line above it says what to do once AR starts - never "your browser will
// ask". The flag is read live, since the tour's file settles after the page
// queried the permission.
describe("a tour that needs no GPS (Q-QF-1)", () => {
  it("never asks: no location tap, a codes-only start, and no re-offer", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    const requestLocationOnce = vi.fn(() =>
      Promise.resolve("granted" as const),
    );
    let flag = false;
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
        requestLocationOnce,
      }),
      dom: d,
      renderArEntry,
      needsNoGps: () => flag,
      codesUsable: () => true,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(true);
    expect(d.arHint.textContent).toMatch(/browser will ask/i);
    // The tour's file settles with the flag.
    flag = true;
    screen.tourChanged();
    expect(screen.locationGate.pending()).toBe(false);
    expect(screen.locationGate.codesOnly()).toBe(true);
    expect(d.arHint.textContent).toBe(
      "Once AR starts, point your phone at the tour's code (on the poster).",
    );
    await screen.locationGate.recheck();
    expect(screen.locationGate.pending()).toBe(false);
    expect(screen.locationGate.codesOnly()).toBe(true);
    expect(requestLocationOnce).not.toHaveBeenCalled();
  });

  // Why: the flag is the creator's word that the codes place the tour, and
  // `tour.json` is external data. A flagged tour with no code that can
  // place it would start a visitor on codes alone with nothing able to
  // place anything and no way to grant location; it asks as before (the
  // M1b-1 review #2 rule for codes-only starts). The flag holds only once
  // the codes are KNOWN to place it (r857 review #4): while the levels are
  // unread - which is for good when their read failed - a tap asks for
  // the location, the safe direction to be wrong in.
  it("holds only while the codes are known to place the tour: unknown and none ask as before", async () => {
    let usable: boolean | null = null;
    const renderArEntry = vi.fn();
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
      }),
      dom: dom(),
      renderArEntry,
      needsNoGps: () => true,
      codesUsable: () => usable,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    // Levels not read yet (or failed to read): ask.
    expect(screen.locationGate.pending()).toBe(true);
    expect(screen.locationGate.codesOnly()).toBe(false);
    usable = true;
    expect(screen.locationGate.pending()).toBe(false);
    expect(screen.locationGate.codesOnly()).toBe(true);
    usable = false;
    expect(screen.locationGate.pending()).toBe(true);
    expect(screen.locationGate.codesOnly()).toBe(false);
  });

  it("asks as before once a tour without the flag replaces it", async () => {
    const d = dom();
    const renderArEntry = vi.fn();
    let flag = true;
    const screen = wireVisitorScreen({
      mode: "visitor",
      seams: seamsWith({
        queryGeolocationPermission: () => Promise.resolve("prompt"),
      }),
      dom: d,
      renderArEntry,
      needsNoGps: () => flag,
      codesUsable: () => true,
    });
    await vi.waitFor(() => expect(renderArEntry).toHaveBeenCalled());
    expect(screen.locationGate.pending()).toBe(false);
    expect(d.arHint.textContent).not.toMatch(/browser will ask/i);
    flag = false;
    screen.tourChanged();
    expect(screen.locationGate.pending()).toBe(true);
    expect(screen.locationGate.codesOnly()).toBe(false);
    expect(d.arHint.textContent).toMatch(/browser will ask/i);
  });
});

// Why (r857 review #4): the screen's `codesUsable` answer as the page
// computes it. A tour whose levels could not be read never gets any, so
// "unknown" would last for the tour: a failed read is "no usable code"
// (false), which keeps a denial on the settings copy and a "needs no GPS"
// flag from starting a visitor no code can place.
describe("tourCodesUsable", () => {
  const lockable = {
    version: 1,
    qr: {
      physicalSizeM: 0.2,
      geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
    },
  } as const;
  const sizeOnly = { version: 1, qr: { physicalSizeM: 0.2 } } as const;

  it("is unknown while the levels are unread, and false once their read failed", () => {
    expect(tourCodesUsable(null, false)).toBeNull();
    expect(tourCodesUsable(null, true)).toBe(false);
  });

  it("is true with a lockable code, false without one", () => {
    expect(tourCodesUsable(new Map([["a", lockable]]), false)).toBe(true);
    expect(tourCodesUsable(new Map([["a", sizeOnly]]), false)).toBe(false);
    expect(tourCodesUsable(new Map(), false)).toBe(false);
  });
});
