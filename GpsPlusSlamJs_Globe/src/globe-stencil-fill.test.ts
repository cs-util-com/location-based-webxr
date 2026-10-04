/**
 * The stencil fill between the relief and the globe (round-6 plan
 * 2026-10-04-1050 G6-1; owner decision 2026-10-04 after the hole
 * measurement).
 *
 * Why this test matters: zooming out and in fast dives, a carrier's own
 * tiles lag the camera, and the background showed through. The relief now
 * marks every pixel it draws in the stencil buffer, and the globe draws
 * only where no mark is, from its coarsest tiles, which it always keeps.
 * So no pixel is left empty and none is drawn twice (no z-fighting at sea
 * level). These tests pin the two materials' stencil state, the one thing
 * that decides it.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  GLOBE_STENCIL,
  asStencilFill,
  asStencilWriter,
} from "./globe-stencil-fill.js";

describe("the stencil fill's roles", () => {
  it("the relief writes its mark on every pixel it draws", () => {
    const m = asStencilWriter(new THREE.MeshStandardMaterial());
    expect(m.stencilWrite).toBe(true);
    expect(m.stencilRef).toBe(GLOBE_STENCIL.ref);
    expect(m.stencilFunc).toBe(THREE.AlwaysStencilFunc);
    expect(m.stencilZPass).toBe(THREE.ReplaceStencilOp);
    expect(m.stencilFail).toBe(THREE.KeepStencilOp);
    expect(m.stencilZFail).toBe(THREE.KeepStencilOp);
  });

  it("the globe draws only where no mark is, and never changes the marks", () => {
    const m = asStencilFill(new THREE.MeshStandardMaterial());
    expect(m.stencilWrite).toBe(true);
    expect(m.stencilRef).toBe(GLOBE_STENCIL.ref);
    expect(m.stencilFunc).toBe(THREE.NotEqualStencilFunc);
    expect(m.stencilZPass).toBe(THREE.KeepStencilOp);
    expect(m.stencilFail).toBe(THREE.KeepStencilOp);
    expect(m.stencilZFail).toBe(THREE.KeepStencilOp);
  });

  it("returns the material it was given, so it chains at creation", () => {
    const m = new THREE.MeshStandardMaterial();
    expect(asStencilWriter(m)).toBe(m);
    expect(asStencilFill(m)).toBe(m);
  });
});
