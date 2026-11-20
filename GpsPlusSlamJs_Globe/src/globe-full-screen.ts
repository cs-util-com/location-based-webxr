/**
 * The Globe passes' full-screen scaffolding: one triangle covering the
 * viewport in its own scene with its own clip-space camera, a half-float
 * target and the resize that keeps it at the drawing buffer's size.
 *
 * @see globe-full-screen.ts.md
 */
import * as THREE from "three";

/** One full-screen triangle with a material, in its own scene. */
export interface FullScreenPass {
  readonly scene: THREE.Scene;
  /** The clip-space camera the triangle is drawn with. */
  readonly camera: THREE.OrthographicCamera;
  /** Draws the triangle into the renderer's current target. */
  render(renderer: THREE.WebGLRenderer): void;
  /** Frees the triangle's geometry; the material stays the caller's. */
  dispose(): void;
}

/**
 * The triangle's corners in clip space: (-1, -1), (3, -1), (-1, 3) cover
 * the square [-1, 1]^2 with one primitive, so no diagonal seam is drawn.
 */
const TRIANGLE = [-1, -1, 0, 3, -1, 0, -1, 3, 0] as const;

/** A full-screen triangle with `material`, never frustum-culled. */
export function fullScreenPass(material: THREE.Material): FullScreenPass {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([...TRIANGLE], 3),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    scene,
    camera,
    render(renderer) {
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
    },
  };
}

/** A half-float target without depth, 1 x 1 until the first frame. */
export const halfFloatTarget = (): THREE.WebGLRenderTarget =>
  new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });

/** Resizes `target` to `w` x `h` when it is not that size already. */
export function fitTarget(
  target: THREE.WebGLRenderTarget,
  w: number,
  h: number,
): void {
  if (target.width !== w || target.height !== h) target.setSize(w, h);
}
