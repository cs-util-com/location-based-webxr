/**
 * The AR press and the offer must never disagree, for ANY inputs.
 *
 * Why this test matters:
 * the "Enter AR now" prompt makes a promise — that pressing AR right now will
 * start a session. If the prompt can ever appear in a state where the press
 * would instead go looking for a fix, the user taps it and the app does
 * something else, which is the confusion the whole milestone exists to remove.
 *
 * `ar-entry.test.ts` pins that agreement over five hand-picked states. This
 * pins it over arbitrary ones — including the coordinates a browser can
 * actually hand back and a table would never think to include: NaN, ±Infinity,
 * poles, the antimeridian, and positions either side of the 100 m gate.
 *
 * The second property is the one the milestone's own review found broken in the
 * WIRING rather than here: an offer must be impossible without an origin. That
 * is a rule about this module, and it is cheap to state exhaustively.
 *
 * @see ar-entry.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

import { arPressAction, shouldOfferAr } from "./ar-entry.js";

/**
 * Coordinates a browser can really produce, hostile ones included.
 *
 * `fc.double` with these flags emits NaN and ±Infinity, which is the point:
 * `greatCircleDistance` returns NaN rather than throwing for them, and NaN
 * compares false against every threshold — so the predicate's DIRECTION is what
 * decides whether a bad fix fails open or closed.
 */
const coordinate = fc.record({
  lat: fc.double({ noNaN: false, noDefaultInfinity: false }),
  lng: fc.double({ noNaN: false, noDefaultInfinity: false }),
});

const inputs = fc.record({
  sessionRunning: fc.boolean(),
  hasOrigin: fc.boolean(),
  lastFix: fc.option(coordinate, { nil: undefined }),
  viewPosition: coordinate,
});

describe("arPressAction and shouldOfferAr, over arbitrary inputs", () => {
  it("offers exactly when a press would enter, and never otherwise", () => {
    // THE INVARIANT THE PROMPT'S HONESTY RESTS ON. Stated as a property rather
    // than a comment because the two are separate exported functions that a
    // future edit could easily drift apart — the offer growing a condition the
    // press does not have would be invisible to every example-based test that
    // did not happen to pick that state.
    fc.assert(
      fc.property(inputs, (state) => {
        const offered = shouldOfferAr({ ...state, awaitingFix: true });
        expect(offered).toBe(arPressAction(state).kind === "enter");
      }),
    );
  });

  it("never offers when no AR press asked for the fix", () => {
    // The locate control is used on its own constantly — by a desktop user
    // finding themselves, and by every AR session's own ~1 Hz watch. There is
    // no state at all in which a fix alone may raise this prompt.
    fc.assert(
      fc.property(inputs, (state) => {
        expect(shouldOfferAr({ ...state, awaitingFix: false })).toBe(false);
      }),
    );
  });

  it("never offers, and never enters, without an origin", () => {
    // `startArMode` refuses without one, so entering would be a promise the app
    // cannot keep. This is the rule that keeps `ar-mode.ts` untouched by the
    // whole redesign.
    fc.assert(
      fc.property(inputs, (state) => {
        const withoutOrigin = { ...state, hasOrigin: false };
        expect(shouldOfferAr({ ...withoutOrigin, awaitingFix: true })).toBe(
          false,
        );
        // `sessionRunning` PINNED FALSE rather than guarded with an `if`. A
        // running session answers `exit` first, by design, so the press claim
        // only applies to the other half — and expressing that as a condition
        // around the assertion trips `vitest/no-conditional-expect`, which is
        // right to complain: a property whose assertion sometimes does not run
        // is a property that can pass without ever being checked.
        expect(
          arPressAction({ ...withoutOrigin, sessionRunning: false }).kind,
        ).toBe("locate");
      }),
    );
  });

  it("always offers a way out of a running session", () => {
    // Whatever else is true. A full-screen view with no exit reads as being
    // trapped, and the exit is the one branch that must not be conditional on
    // anything a GPS chip does.
    fc.assert(
      fc.property(inputs, (state) => {
        expect(arPressAction({ ...state, sessionRunning: true })).toEqual({
          kind: "exit",
        });
      }),
    );
  });

  it("never enters on a non-finite coordinate", () => {
    // FAILS CLOSED, and this is the property the belt-and-braces finite guard
    // in `isShowingUser` is really there to make deliberate: the predicate asks
    // "is the view WITHIN the gate", and NaN answers no to that — whereas the
    // mirror-image phrasing, "is it beyond the gate", would answer no as well
    // and mean the opposite. The two look interchangeable and are not.
    const broken = fc.oneof(
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
    );
    fc.assert(
      fc.property(
        fc.record({ lat: broken, lng: broken }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        (badFix, lat) => {
          expect(
            arPressAction({
              sessionRunning: false,
              hasOrigin: true,
              lastFix: badFix,
              viewPosition: { lat, lng: 0 },
            }),
          ).toEqual({ kind: "locate" });
        },
      ),
    );
  });
});
