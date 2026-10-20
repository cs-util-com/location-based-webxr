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
  topLevelInView,
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

describe("topLevelReady with nothing of the set in view", () => {
  // Why: a view placed under the relief (a link's ellipsoidal height below
  // the ground, the editor's first person before the clearance lifts it)
  // that looks steeply down sees none of the relief: the library clears
  // `inFrustum` on every tile none of whose children is in view, up to the
  // top level. "No top-level tile in view" then read as "not ready", so
  // the relief never took a pixel, and the clearance, which lifts the
  // camera only where the relief draws, never got the camera out: the
  // lab's steep first views below the ground stayed on the globe for good.
  // A set its last update visited with nothing in view has nothing missing
  // from the view: it is ready.
  it("is ready when its top-level tiles were visited this frame and none is in view", () => {
    const root = tile(true, 7, false, [tile(true, 7, false)]);
    expect(topLevelReady({ root, frameCount: 7 })).toBe(true);
    // Even when such a tile is still loading: nothing of it is drawn here.
    const loading = tile(true, 7, false, [tile(false, 7, false)]);
    expect(topLevelReady({ root: loading, frameCount: 7 })).toBe(true);
  });

  // Why: the other half of the rule must survive: a set whose last update
  // did not visit its top level this frame has said nothing about the view.
  it("is still not ready when no top-level tile was visited this frame", () => {
    const root = tile(true, 6, false, [tile(true, 6, false)]);
    expect(topLevelReady({ root, frameCount: 7 })).toBe(false);
    expect(
      topLevelReady({ root: tile(true, 7, false, []), frameCount: 7 }),
    ).toBe(false);
  });
});

describe("topLevelInView", () => {
  // Why: the globe's first look (the plain sphere that fills its holes
  // until it has first drawn its view) must not end on a frame that saw
  // none of the globe. With "nothing in view is ready" above, a camera
  // that starts looking away from the Earth would end it for good, and
  // turning to the Earth would show the holes it exists to fill. The first
  // look therefore also asks whether a top-level tile was in view.
  it("is true only for a top-level tile visited this frame and in view", () => {
    expect(
      topLevelInView({
        root: tile(true, 7, true, [tile(false, 7)]),
        frameCount: 7,
      }),
    ).toBe(true);
    expect(
      topLevelInView({
        root: tile(true, 7, true, [tile(true, 7, false), tile(true, 6)]),
        frameCount: 7,
      }),
    ).toBe(false);
    expect(topLevelInView({ root: null, frameCount: 0 })).toBe(false);
    expect(
      topLevelInView({ root: tile(true, 7, true, []), frameCount: 7 }),
    ).toBe(false);
  });
});

describe("topLevelReady over random top levels", () => {
  // Why: the gate's readiness must hold for any mix of top-level tiles a
  // frame can show, not only the cases named above: a top-level tile in
  // view that is still loading always blocks (that is the hole the gate
  // exists to prevent), tiles out of view or not visited this frame never
  // block, and a set its last update did not visit is never ready.
  it("blocks exactly on a visited, in-view tile that has not loaded", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            loaded: fc.boolean(),
            visited: fc.boolean(),
            inView: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        (tiles) => {
          const root = tile(
            true,
            7,
            true,
            tiles.map((t) => tile(t.loaded, t.visited ? 7 : 6, t.inView)),
          );
          const ready = topLevelReady({ root, frameCount: 7 });
          const anyVisited = tiles.some((t) => t.visited);
          const hole = tiles.some((t) => t.visited && t.inView && !t.loaded);
          expect(ready).toBe(anyVisited && !hole);
        },
      ),
    );
  });
});

describe("the hand-over with the relief's view empty", () => {
  // Why this test matters: "nothing in view is ready" (above) makes the
  // gate one-way for a camera under the relief: with the relief's top level
  // out of the frustum the relief reads ready, so with the globe ready too
  // the share walks to the altitude's target - 1 at a low altitude - and
  // stays there, though the relief draws nothing yet. Nothing in the gate
  // takes the share back, because the handover does not change what made
  // the relief ready. That is the intended escape, pinned here as a
  // decision rather than left as a consequence: the share at the relief is
  // what lets its tiles load and refine under the camera, and the
  // clearance (which lifts the camera only where the relief draws) then
  // lifts the camera above the relief's ground, where its top level is in
  // view again and the ordinary rule holds (`topLevelReady`'s comment says
  // why that is the only way the whole top level leaves the view).
  it("hands the whole view to a relief whose top level is out of view, at the bounded rate, and keeps it there", () => {
    const relief = {
      root: tile(true, 7, false, [tile(false, 7, false), tile(true, 7, false)]),
      frameCount: 7,
    };
    const globe = { root: tile(true, 7, true, [tile(true, 7)]), frameCount: 7 };
    const reliefReady = topLevelReady(relief);
    const globeReady = topLevelReady(globe);
    expect({ reliefReady, globeReady }).toEqual({
      reliefReady: true,
      globeReady: true,
    });
    // Enough 16 ms frames to cross the whole share at the bounded rate,
    // and 50 more.
    const frames = Math.ceil(1000 / (GLOBE_BAND_GATE.sharePerS * 16)) + 50;
    let drawn = 0;
    const shares: number[] = [];
    for (let frame = 0; frame < frames; frame++) {
      drawn = nextDrawnShare({
        drawn,
        target: 1,
        reliefReady,
        globeReady,
        dtMs: 16,
      });
      shares.push(drawn);
    }
    // Never a jump: at most sharePerS a second (16 ms frames).
    const perFrame = (GLOBE_BAND_GATE.sharePerS * 16) / 1000;
    for (const [i, share] of shares.entries()) {
      const before = i === 0 ? 0 : shares[i - 1]!;
      expect(share - before).toBeLessThanOrEqual(perFrame + 1e-12);
    }
    // At 1 once the rate allows, and held there.
    expect(shares.slice(-50).every((share) => share === 1)).toBe(true);
  });
});
