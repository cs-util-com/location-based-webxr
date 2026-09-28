/**
 * Why this test matters: the globe's pin is an async button (CLAUDE.md's
 * async-feedback rule; round-2 plan 2026-09-26-2055 M3g). A GPS fix takes
 * seconds and the dive 15 s more, so the button must say what is happening
 * at every step, must not accept a second press while it waits for the
 * fix, must let a press stop the flight, and must come back to idle after
 * any failure: a pin stuck on "Finding you..." is the one outcome worse
 * than an error message.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_PIN_EVENTS,
  GLOBE_PIN_PHASES,
  globePinView,
  nextPinPhase,
  type GlobePinPhase,
} from "./globe-pin.js";

describe("nextPinPhase", () => {
  it("runs the granted path: idle, locating, flying, handing over", () => {
    let phase: GlobePinPhase = "idle";
    phase = nextPinPhase(phase, "press");
    expect(phase).toBe("locating");
    phase = nextPinPhase(phase, "located");
    expect(phase).toBe("flying");
    phase = nextPinPhase(phase, "arrived");
    expect(phase).toBe("handingOver");
  });

  it("holds at the end of the dive with the hand-over off, pressable again", () => {
    expect(nextPinPhase("flying", "held")).toBe("idle");
  });

  it("returns to idle after a failed locate", () => {
    expect(nextPinPhase("locating", "failed")).toBe("idle");
  });

  it("lets a press cancel the wait for the fix", () => {
    // A browser can leave the request pending (a permission prompt left
    // open); a disabled pin would then be stuck with it.
    expect(nextPinPhase("locating", "press")).toBe("idle");
  });

  it("stops the flight on a press of the pin or a touch on the globe", () => {
    expect(nextPinPhase("flying", "press")).toBe("idle");
    expect(nextPinPhase("flying", "touch")).toBe("idle");
  });

  it("lets the user play with the globe while it waits for the fix", () => {
    // The fix still flies there once it comes: the user asked for it.
    expect(nextPinPhase("locating", "touch")).toBe("locating");
  });

  it("stays handing over whatever happens: the page is leaving", () => {
    for (const event of GLOBE_PIN_EVENTS) {
      expect(nextPinPhase("handingOver", event)).toBe("handingOver");
    }
  });

  it("never reaches a phase from nowhere: late events change nothing", () => {
    // A fix or an arrival that comes after a cancel must not restart a
    // flight nobody is waiting for.
    expect(nextPinPhase("idle", "located")).toBe("idle");
    expect(nextPinPhase("idle", "arrived")).toBe("idle");
    expect(nextPinPhase("idle", "failed")).toBe("idle");
    expect(nextPinPhase("idle", "held")).toBe("idle");
    expect(nextPinPhase("locating", "held")).toBe("locating");
    expect(nextPinPhase("idle", "touch")).toBe("idle");
  });

  it("always lands on a known phase, from any sequence of events", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...GLOBE_PIN_EVENTS), { maxLength: 30 }),
        (events) => {
          let phase: GlobePinPhase = "idle";
          for (const event of events) {
            phase = nextPinPhase(phase, event);
            expect(GLOBE_PIN_PHASES).toContain(phase);
          }
        },
      ),
    );
  });
});

describe("globePinView", () => {
  it("gives every phase its own label", () => {
    const labels = GLOBE_PIN_PHASES.map((p) => globePinView(p).label);
    expect(new Set(labels).size).toBe(GLOBE_PIN_PHASES.length);
    for (const label of labels) expect(label.trim()).not.toBe("");
  });

  it("says it is finding you, busy but pressable to cancel, while it waits for the fix", () => {
    expect(globePinView("locating")).toEqual({
      label: "Finding you... - tap to cancel",
      disabled: false,
      busy: true,
    });
  });

  it("stays pressable while flying, and says a press stops it", () => {
    const view = globePinView("flying");
    expect(view.disabled).toBe(false);
    expect(view.busy).toBe(true);
    expect(view.label).toMatch(/stop/i);
  });

  it("is idle and pressable at rest, and disabled while the page leaves", () => {
    expect(globePinView("idle")).toMatchObject({
      disabled: false,
      busy: false,
    });
    expect(globePinView("handingOver")).toMatchObject({
      disabled: true,
      busy: true,
    });
  });
});
