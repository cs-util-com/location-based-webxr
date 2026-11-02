/**
 * Why these tests matter: every input must have exactly one owner, or the
 * camera and the editor both act on it (a turn that also opens the menu)
 * or neither does (a click that is lost). These check, for any input and
 * any threshold in the measured range, that the table answers with one
 * route, that a click and a drag of the same press never route alike for
 * the right button, and that only a press on a handle ever reaches the
 * gizmo.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  routeGlobeInput,
  type GlobeHit,
  type GlobeInput,
} from "./globe-gestures.js";

const hit = fc.constantFrom<GlobeHit>("object", "handle", "ground", "sky");
const button = fc.constantFrom<"left" | "right">("left", "right");
const input: fc.Arbitrary<GlobeInput> = fc.oneof(
  fc.record({ kind: fc.constant("press" as const), button, on: hit }),
  fc.record({
    kind: fc.constant("release" as const),
    button,
    on: hit,
    movedPx: fc.double({ min: 0, max: 500, noNaN: true }),
  }),
  fc.record({ kind: fc.constant("double" as const), on: hit }),
  fc.record({ kind: fc.constant("arrow" as const), selected: fc.boolean() }),
  fc.record({ kind: fc.constant("fingers" as const), on: hit }),
);
const ROUTES = new Set([
  "camera",
  "edit",
  "select",
  "deselect",
  "menu",
  "select-and-fly",
  "camera-zoom",
  "nudge",
  "camera-step",
  "none",
]);

describe("routeGlobeInput, for any input", () => {
  it("answers with exactly one known route for any threshold in 3-8 px", () => {
    fc.assert(
      fc.property(input, fc.double({ min: 3, max: 8, noNaN: true }), (i, d) => {
        expect(ROUTES.has(routeGlobeInput(i, d))).toBe(true);
      }),
    );
  });

  it("routes a right click and a right drag of one press differently", () => {
    fc.assert(
      fc.property(
        hit,
        fc.double({ min: 3, max: 8, noNaN: true }),
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        (on, dragPx, short, long) => {
          const at = (movedPx: number) =>
            routeGlobeInput(
              { kind: "release", button: "right", on, movedPx },
              dragPx,
            );
          expect(at(dragPx * short)).toBe("menu");
          expect(at(dragPx * long)).toBe("none");
        },
      ),
    );
  });

  it("gives the gizmo only a left button on a handle", () => {
    fc.assert(
      fc.property(input, (i) => {
        const gizmo =
          (i.kind === "press" || i.kind === "release") &&
          i.button === "left" &&
          i.on === "handle";
        // Edit if and only if a left press or release lands on a handle.
        expect(routeGlobeInput(i) === "edit").toBe(gizmo);
      }),
    );
  });
});
