/**
 * The stencil fill between the relief and the globe (round-6 plan
 * 2026-10-04-1050 G6-1): the relief draws first and marks every pixel it
 * draws; the globe draws after it, only where no mark is, from the coarse
 * tiles it always keeps. No pixel is left empty when the relief's tiles lag
 * the camera (zooming out, fast dives), and none is drawn twice.
 *
 * The page needs a stencil buffer (`new WebGLRenderer({ stencil: true })`)
 * and draws the relief's group before the globe's (`renderOrder`).
 *
 * @see globe-stencil-fill.ts.md
 */
import * as THREE from "three";

/** The stencil value the relief writes. */
export const GLOBE_STENCIL = Object.freeze({ ref: 1 });

/** The relief's role: every drawn pixel gets the mark. Returns `material`. */
export function asStencilWriter<M extends THREE.Material>(material: M): M {
  material.stencilWrite = true;
  material.stencilRef = GLOBE_STENCIL.ref;
  material.stencilFunc = THREE.AlwaysStencilFunc;
  material.stencilZPass = THREE.ReplaceStencilOp;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  return material;
}

/** The globe's role: draw only where no mark is; keep the marks. Returns `material`. */
export function asStencilFill<M extends THREE.Material>(material: M): M {
  material.stencilWrite = true;
  material.stencilRef = GLOBE_STENCIL.ref;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilZPass = THREE.KeepStencilOp;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  return material;
}
