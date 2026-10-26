/**
 * Why these tests matter: a placed model's `sizeM` is its LARGEST side
 * after scaling (the format's one rule), and every page that draws a
 * model scales it by this one function: a box 2 x 4 x 1 m asked to be 8 m
 * is scaled by 2, whatever its own node transforms are. A model with
 * nothing to measure must not be blown up to infinity.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { modelScale } from "./model-scale.js";

describe("modelScale", () => {
  // Why: a placed model's `sizeM` is its LARGEST side after scaling (the
  // format's one rule): a box 2 x 4 x 1 m asked to be 8 m is scaled by 2,
  // whatever its own node transforms are.
  it("scales the largest side of the model's box to the size", () => {
    const model = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1));
    model.add(box);
    expect(modelScale(model, 8)).toBeCloseTo(2, 9);
    // A node transform counts: the same box scaled by 3 inside the model.
    box.scale.setScalar(3);
    expect(modelScale(model, 6)).toBeCloseTo(0.5, 9);
  });

  // Why: a model with nothing to measure (an empty scene, a point) must
  // not be blown up to infinity; it is drawn at its own size.
  it("keeps a model with no extent at its own size", () => {
    expect(modelScale(new THREE.Group(), 5)).toBe(1);
    const flat = new THREE.Group();
    flat.add(new THREE.Mesh(new THREE.PlaneGeometry(0, 0)));
    expect(modelScale(flat, 5)).toBe(1);
  });

  it("refuses a size that is not finite and > 0", () => {
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    expect(() => modelScale(model, 0)).toThrow(RangeError);
    expect(() => modelScale(model, Number.NaN)).toThrow(RangeError);
  });
});
