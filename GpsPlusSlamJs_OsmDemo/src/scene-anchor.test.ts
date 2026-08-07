/**
 * The scene anchor — where the ENU frame's origin sits, and when it moves.
 *
 * Why these tests matter:
 * The demo used to derive its ENU origin from the user's current position on
 * every publish, so every vertex in the scene moved whenever the user did. The
 * AR framework's origin is the opposite: `setZeroPos` sets it once per session
 * and never again. The two could not share a scene, which is the whole reason
 * this module exists.
 *
 * The rule is deliberately TWO rules, because the two ways a position changes
 * differ in kind:
 *
 * - **Choosing a new place is a declared discontinuity** and re-anchors with no
 *   distance test at all. The site picker spans Cologne to Tokyo — ~9 000 km —
 *   and at that offset the frame's fixed longitude scale is wrong by ~29 %, so
 *   the city would be sheared rather than merely imprecise.
 * - **A map click or a step is ordinary navigation** that happens to be able to
 *   go far, so it re-anchors only past a threshold.
 *
 * @see scene-anchor.ts.md
 */

import { describe, expect, it } from "vitest";

import {
  REANCHOR_THRESHOLD_M,
  createAnchorHolder,
  nextAnchor,
} from "./scene-anchor.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const TOKYO = { lat: 35.6896, lng: 139.7006 };

/** `metres` north of `from`, near enough for a threshold test. */
const northOf = (from: { lat: number; lng: number }, metres: number) => ({
  lat: from.lat + metres / 111_320,
  lng: from.lng,
});

describe("nextAnchor", () => {
  it("keeps the anchor for a step", () => {
    // THE CASE THE WHOLE CHANGE EXISTS FOR. A walking step must not move the
    // origin, or every vertex in the scene moves with it.
    const result = nextAnchor(COLOGNE, northOf(COLOGNE, 50));

    expect(result.reanchored).toBe(false);
    expect(result.origin).toEqual(COLOGNE);
  });

  it("keeps the anchor for a long walk that stays under the threshold", () => {
    const result = nextAnchor(COLOGNE, northOf(COLOGNE, 4_000));

    expect(result.reanchored).toBe(false);
    expect(result.origin).toEqual(COLOGNE);
  });

  it("re-anchors past the threshold", () => {
    const far = northOf(COLOGNE, REANCHOR_THRESHOLD_M + 500);
    const result = nextAnchor(COLOGNE, far);

    expect(result.reanchored).toBe(true);
    expect(result.origin).toEqual(far);
  });

  it("re-anchors for a declared place change however small the move", () => {
    // THE SITE PICKER'S RULE. Choosing a place is a discontinuity, not travel,
    // so it does not consult the distance at all — a picker entry a few metres
    // away still starts a new scene.
    const result = nextAnchor(COLOGNE, northOf(COLOGNE, 5), {
      declared: true,
    });

    expect(result.reanchored).toBe(true);
    expect(result.origin).toEqual(northOf(COLOGNE, 5));
  });

  it("re-anchors for the site picker's actual span", () => {
    // Cologne to Tokyo. Without this the frame's fixed longitude scale
    // (cos 50.94 = 0.630 against cos 35.69 = 0.812) would be wrong by ~29 %
    // and the city would be sheared, not merely offset.
    const result = nextAnchor(COLOGNE, TOKYO, { declared: true });

    expect(result.reanchored).toBe(true);
    expect(result.origin).toEqual(TOKYO);
  });

  it("re-anchors a continent-scale move even when it is NOT declared", () => {
    // A map click at low zoom can cross an ocean with no picker involved, so
    // the threshold has to be a real backstop rather than a formality that the
    // declared path always covers.
    const result = nextAnchor(COLOGNE, TOKYO);

    expect(result.reanchored).toBe(true);
    expect(result.origin).toEqual(TOKYO);
  });

  describe("the threshold itself", () => {
    it("is 5 km, the conservative end of the owner's range", () => {
      // Stated as a number so a later edit has to argue with a test. The owner
      // chose ~5-10 km; 5 km never fires during a walk or a normal map drag
      // and halves the worst-case frame distortion against the 10 km end.
      expect(REANCHOR_THRESHOLD_M).toBe(5_000);
    });

    it("crosses within 100 m of the stated threshold", () => {
      // PINS THE VALUE, NOT THE OPERATOR. An earlier version of this test
      // claimed to pin `>` against `>=` at exactly 5 000 m — and could not: a
      // great-circle distance never lands exactly on 5 000.000 m, so both
      // operators give the same answer and the mutation survived. The
      // distinction is unobservable and therefore not asserted.
      //
      // What IS worth pinning is that the crossing happens where the constant
      // says, which catches a threshold silently scaled or a unit mix-up.
      expect(nextAnchor(COLOGNE, northOf(COLOGNE, 4_900)).reanchored).toBe(
        false,
      );
      expect(nextAnchor(COLOGNE, northOf(COLOGNE, 5_100)).reanchored).toBe(
        true,
      );
    });
  });

  describe("defensive behaviour", () => {
    it("adopts the position when there is no anchor yet", () => {
      // The first call of a session. `undefined` is how "no scene yet" is said,
      // and it must produce an anchor rather than a comparison against nothing.
      const result = nextAnchor(undefined, COLOGNE);

      expect(result.reanchored).toBe(true);
      expect(result.origin).toEqual(COLOGNE);
    });

    it("re-anchors rather than trusting a non-finite position", () => {
      // A NaN would poison every ENU coordinate derived from the frame, and
      // `greatCircleDistance` returns NaN rather than throwing — so a naive
      // `distance > threshold` would be false and the bad value would be kept
      // as the anchor's basis. Failing towards a fresh anchor is visible.
      expect(() => nextAnchor(COLOGNE, { lat: Number.NaN, lng: 0 })).toThrow(
        /position/i,
      );
      expect(() => nextAnchor(COLOGNE, { lat: 0, lng: Infinity })).toThrow(
        /position/i,
      );
    });
  });
});

describe("createAnchorHolder", () => {
  it("advances ONCE and every reader afterwards sees the new origin", () => {
    // WHY THIS TEST MATTERS. The anchor used to be decided inside the refresh
    // cycle, which runs LAST of the three things a position change triggers.
    // The camera pivot and the terrain load both read the held anchor BEFORE
    // that, so on a re-anchor they used the outgoing frame: after a
    // Cologne -> Tokyo pick the camera pivoted ~9 000 km from the scene and the
    // terrain would have been sampled in a frame the buildings no longer used.
    //
    // Making the holder the single decision point is what removes that class of
    // bug structurally rather than by ordering the statements carefully.
    const anchors = createAnchorHolder(COLOGNE);
    expect(anchors.origin).toEqual(COLOGNE);

    const decision = anchors.advance(TOKYO, { declared: true });

    expect(decision.reanchored).toBe(true);
    expect(decision.origin).toEqual(TOKYO);
    // The reader that runs after `advance` must not be able to see the old one.
    expect(anchors.origin).toEqual(TOKYO);
  });

  it("keeps the origin for a step, so repeated reads are stable", () => {
    // The counterweight to the case above: advancing is not the same as moving.
    const anchors = createAnchorHolder(COLOGNE);
    const stepped = northOf(COLOGNE, 20);

    const decision = anchors.advance(stepped);

    expect(decision.reanchored).toBe(false);
    expect(anchors.origin).toEqual(COLOGNE);
  });

  it("seeds from the start position, so the first read precedes any advance", () => {
    // The demo has no GPS: the origin is the resolved start position, taken once
    // at construction (DEC-R11-7 §4.1). Something reads it — the initial terrain
    // load — before any position change has happened.
    const anchors = createAnchorHolder(COLOGNE);
    expect(anchors.origin).toEqual(COLOGNE);
  });

  it("re-anchors past the threshold without a declaration", () => {
    const anchors = createAnchorHolder(COLOGNE);
    const far = northOf(COLOGNE, REANCHOR_THRESHOLD_M + 1_000);

    expect(anchors.advance(far).reanchored).toBe(true);
    expect(anchors.origin).toEqual(far);
  });

  it("keeps the last good origin when a position is not finite", () => {
    // `nextAnchor` throws rather than poisoning the frame; the holder must not
    // swallow that into a half-updated state where `origin` is NaN.
    const anchors = createAnchorHolder(COLOGNE);

    expect(() => anchors.advance({ lat: Number.NaN, lng: 0 })).toThrow(
      RangeError,
    );
    expect(anchors.origin).toEqual(COLOGNE);
  });
});
