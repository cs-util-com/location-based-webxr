// @vitest-environment jsdom
/**
 * Why these properties matter: a note's place is rounded to a step that
 * follows the model's size (`roundTo` / `placeExponent`), and the result
 * is compared with `===` (`sameVector` in `model-edits.ts`) and checked by
 * the format's rule before it is written. For any click and any model
 * size the rounded place must stay within half a step of the click,
 * never be -0 (which `===` would not tell from 0, and the file would
 * write as 0, so an edit would read as a change that is none), and a
 * point the format takes must still be one after rounding - on both sides
 * of the boundary where the step turns from a decimal (`toFixed`) to a
 * whole power of ten (a model of 10 km and more).
 */
import fc from "fast-check";
import * as THREE from "three";
import { TOUR_MODEL_SPACE_MAX } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { TourModel } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { describe, expect, it } from "vitest";

import { applyModelEdit } from "../editor/model-edits.js";
import { largestSide } from "../model-scale.js";
import { noteSpotOf } from "./editor3d-model-parts.js";

/** A cube model of side `side` (the file's units) and a click on it at
 *  `point`, its surface facing up. */
function clickOn(side: number, point: readonly [number, number, number]) {
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(side, side, side));
  model.add(mesh);
  model.updateMatrixWorld(true);
  const hit = {
    point: new THREE.Vector3(...point),
    face: { normal: new THREE.Vector3(0, 1, 0) },
    object: mesh,
  } as unknown as THREE.Intersection;
  return { model, hit };
}

/** The rounding step `noteSpotOf` uses for a model whose largest side
 *  is `side`: the power of ten nearest below a ten-thousandth of it. The
 *  side is the model's as measured (`largestSide`), not the one asked
 *  for: a cube of side just below a power of ten may measure a float's
 *  width over it, and the step then is ten times larger. */
const stepOf = (side: number): number =>
  10 ** Math.floor(Math.log10(side * 1e-4));

const MODEL = {
  id: "m",
  kind: "model",
  view: "placed",
  asset: "a",
  sizeM: 2,
  geo: { lat: 48.1, lon: 11.5, alt: 520, headingDeg: 0 },
} as TourModel;

/** Model sides from a millimetre to 1000 km, log-uniform, so both sides
 *  of the 10 km boundary (a whole step from there up) are drawn often. */
const side = fc.double({ min: -3, max: 6, noNaN: true }).map((e) => 10 ** e);

const coordinate = fc.double({
  min: -TOUR_MODEL_SPACE_MAX,
  max: TOUR_MODEL_SPACE_MAX,
  noNaN: true,
});

describe("noteSpotOf's rounding (properties)", () => {
  it("keeps a click within half a step, never -0, and a spot the format takes", () => {
    fc.assert(
      fc.property(
        side,
        fc.tuple(coordinate, coordinate, coordinate),
        (s, point) => {
          const { model, hit } = clickOn(s, point);
          const spot = noteSpotOf(model, hit);
          expect(spot).not.toBeNull();
          const step = stepOf(largestSide(model));
          for (const [i, v] of (spot?.position ?? []).entries()) {
            expect(Object.is(v, -0)).toBe(false);
            // Half a step, and a hair over it for the point's float error.
            expect(Math.abs(v - point[i]!)).toBeLessThanOrEqual(
              step / 2 + Math.abs(point[i]!) * 1e-12,
            );
          }
          const added = applyModelEdit(
            MODEL,
            { kind: "note-add", at: spot! },
            false,
          );
          expect(added.kind).toBe("edited");
        },
      ),
      // A click a float's width over half a step from a near-zero
      // coordinate on a model that measures a hair under a power of ten;
      // and clicks just under half a step on models just under a power
      // of ten, where a step taken from the asked-for side would be wrong.
      {
        examples: [
          [0.9999999999999988, [0, -0.000005000000000005001, 0]],
          [0.99999999, [0, 4.95e-5, 0]],
          [99_999.999, [0, 0.495, 0]],
          [9_999.9999, [0, 0.0495, 0]],
        ],
      },
    );
  });

  it("writes 0, not -0, for a click a hair below zero, at either side of the boundary", () => {
    for (const s of [1, 9_999, 10_000, 1e6]) {
      const { model, hit } = clickOn(s, [-1e-9, -1e-12, -0]);
      const position = noteSpotOf(model, hit)?.position ?? [];
      expect(position.map((v) => Object.is(v, -0))).toEqual([
        false,
        false,
        false,
      ]);
    }
  });
});
