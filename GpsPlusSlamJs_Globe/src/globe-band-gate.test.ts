/**
 * The band's hand-over gated by readiness (round-6 plan 2026-10-04-1050
 * G6-1, DEC-G6-2).
 *
 * Why this test matters: the owner saw the whole Earth turn blue at the
 * switch between the globe and the relief, zooming in and zooming out. The
 * share of pixels each carrier draws followed the altitude alone, so the
 * relief took pixels before it had any tile there, and the globe gave its
 * pixels away after its tiles had been released. These tests pin the rule
 * that removes the holes: a carrier takes pixels only once it is ready, the
 * other keeps them until then, and the share moves at a bounded rate so a
 * carrier becoming ready never pops.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLOBE_BAND_GATE,
  nextDrawnShare,
  topLevelReady,
} from "./globe-band-gate.js";

describe("nextDrawnShare", () => {
  const step = (o: Partial<Parameters<typeof nextDrawnShare>[0]>) =>
    nextDrawnShare({
      drawn: 0,
      target: 0,
      reliefReady: true,
      globeReady: true,
      dtMs: 16,
      ...o,
    });

  it("follows the altitude's target when both carriers are ready, at a bounded rate", () => {
    const perFrame = (GLOBE_BAND_GATE.sharePerS * 16) / 1000;
    expect(step({ drawn: 0, target: 1 })).toBeCloseTo(perFrame, 12);
    expect(step({ drawn: 0.5, target: 0.51 })).toBeCloseTo(0.51, 12);
    expect(step({ drawn: 1, target: 0 })).toBeCloseTo(1 - perFrame, 12);
  });

  it("gives the relief no pixel before it is ready, and hands them all to the globe at once when the relief cannot draw", () => {
    expect(step({ drawn: 0, target: 1, reliefReady: false })).toBe(0);
    // Drawing some, then a hole in the relief (zooming out widens the view
    // past its tiles): a hole is worse than a quick swap, so the globe
    // takes every pixel in this frame (2026-10-04 zoom-out measurement).
    expect(step({ drawn: 0.4, target: 1, reliefReady: false })).toBe(0);
  });

  it("hands every pixel to the relief at once while the globe cannot draw", () => {
    expect(step({ drawn: 1, target: 0, globeReady: false })).toBe(1);
    expect(step({ drawn: 0.3, target: 0, globeReady: false })).toBe(1);
  });

  it("holds where it is when neither carrier is ready", () => {
    expect(
      step({ drawn: 0.3, target: 1, reliefReady: false, globeReady: false }),
    ).toBe(0.3);
  });

  it("refuses non-finite input and a share outside 0-1", () => {
    expect(() => step({ drawn: Number.NaN })).toThrow(RangeError);
    expect(() => step({ target: 1.5 })).toThrow(RangeError);
    expect(() => step({ dtMs: -1 })).toThrow(RangeError);
  });

  it("never gives pixels to a carrier that cannot draw, moves at a bounded rate while both can, and reaches the target", () => {
    const share = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        share,
        share,
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0, max: 200, noNaN: true }),
        (drawn, target, reliefReady, globeReady, dtMs) => {
          const next = nextDrawnShare({
            drawn,
            target,
            reliefReady,
            globeReady,
            dtMs,
          });
          const limit = (GLOBE_BAND_GATE.sharePerS * dtMs) / 1000;
          const both = reliefReady && globeReady;
          // What each rule says, as named facts; all must hold.
          const facts = {
            inRange: next >= 0 && next <= 1,
            // Bounded rate while both can draw; one carrier alone takes
            // all; neither, it holds.
            rule: both
              ? Math.abs(next - drawn) <= limit + 1e-12
              : reliefReady
                ? next === 1
                : globeReady
                  ? next === 0
                  : next === drawn,
            // More relief only when the relief is ready; more globe only
            // when the globe is.
            reliefOnlyIfReady: !(next > drawn + 1e-12) || reliefReady,
            globeOnlyIfReady: !(next < drawn - 1e-12) || globeReady,
            // Both ready: never past the target, always toward it.
            towardTarget:
              !both ||
              Math.abs(target - next) <= Math.abs(target - drawn) + 1e-12,
          };
          expect(facts).toEqual({
            inRange: true,
            rule: true,
            reliefOnlyIfReady: true,
            globeOnlyIfReady: true,
            towardTarget: true,
          });
        },
      ),
    );
  });
});

/** A tile as `topLevelReady` reads it (the library's fields). */
function tile(
  loaded: boolean,
  visitedFrame: number,
  inFrustum = true,
  children: unknown[] = [],
) {
  return {
    internal: { loadingState: loaded ? 4 : 2 },
    traversal: { lastFrameVisited: visitedFrame, inFrustum, used: true },
    children,
  };
}

describe("topLevelReady", () => {
  it("is ready when every top-level tile in view this frame has loaded", () => {
    const root = tile(true, 7, true, [tile(true, 7), tile(true, 7)]);
    expect(topLevelReady({ root, frameCount: 7 })).toBe(true);
  });

  it("is not ready while one top-level tile in view is still loading", () => {
    const root = tile(true, 7, true, [tile(true, 7), tile(false, 7)]);
    expect(topLevelReady({ root, frameCount: 7 })).toBe(false);
  });

  it("ignores top-level tiles out of view or not visited this frame", () => {
    const root = tile(true, 7, true, [
      tile(true, 7),
      tile(false, 7, false),
      tile(false, 6),
    ]);
    expect(topLevelReady({ root, frameCount: 7 })).toBe(true);
  });

  it("is not ready before any top-level tile was visited (never updated)", () => {
    expect(topLevelReady({ root: null, frameCount: 0 })).toBe(false);
    const root = tile(true, 3, true, [tile(false, 3)]);
    expect(topLevelReady({ root, frameCount: 9 })).toBe(false);
  });
});
