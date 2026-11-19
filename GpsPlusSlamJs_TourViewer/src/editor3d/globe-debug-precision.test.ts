/**
 * Why these tests matter: the debug layer's captures reach the GPU as
 * 32-bit floats (the thumbnails' instanced `center`, the line's points),
 * and the GPU multiplies them by a 32-bit model-view matrix. A scan far
 * from the tour frame's centre (a new tour opens over the creator's part
 * of the world, the scan may be thousands of km from there) then loses
 * its place to rounding: two numbers near the distance cancel to the few
 * metres between the camera and the capture, and the rounding of each is
 * a fraction of a metre at 8000 km. These tests emulate that arithmetic
 * with `Math.fround` and sweep the distance, so the choice between
 * drawing the captures relative to their own anchor and re-centring the
 * tour's frame rests on numbers: relative coordinates must stay well
 * under a pixel at every distance, while the direct ones are shown to
 * jitter far.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

const f = Math.fround;
const WIDTH_PX = 1280;
const HEIGHT_PX = 720;
const FOV_DEG = 50;

/** `m * v` as a GPU does it: 32-bit inputs, each product and sum rounded. */
function mulGpu(m: Float32Array, v: readonly number[]): number[] {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    let acc = f(m[row]! * v[0]!);
    acc = f(acc + f(m[4 + row]! * v[1]!));
    acc = f(acc + f(m[8 + row]! * v[2]!));
    acc = f(acc + m[12 + row]!);
    out.push(acc);
  }
  return out;
}

/** The pixel a point in eye space lands on (exact projection). */
function pixelOf(eye: readonly number[]): [number, number] {
  const focal = HEIGHT_PX / 2 / Math.tan((FOV_DEG * Math.PI) / 360);
  const depth = -eye[2]!;
  return [(focal * eye[0]!) / depth, (focal * eye[1]!) / depth];
}

/**
 * The on-screen error of one capture `distanceM` from the frame's centre,
 * seen from `viewM` away, while the camera creeps 1 mm a frame for 200
 * frames: the largest error and the largest change of it between two
 * frames (the jitter), in px. `relative`: drawn as an offset from an
 * anchor `walkM` along the walk (the object's position, so the anchor
 * goes into the 64-bit model matrix), else as its own 32-bit
 * coordinates.
 */
function screenError(
  distanceM: number,
  viewM: number,
  relative: boolean,
  walkM: number,
): { readonly staticPx: number; readonly jitterPx: number } {
  const dir = new THREE.Vector3(1, -0.3, 0.7).normalize();
  const capture = dir.clone().multiplyScalar(distanceM);
  // The walk's anchor: another capture `walkM` along the walk.
  const anchor = capture
    .clone()
    .add(new THREE.Vector3(0.8, 0, -0.6).multiplyScalar(walkM));
  const model = new THREE.Matrix4();
  if (relative) model.makeTranslation(anchor.x, anchor.y, anchor.z);
  const attribute = relative ? capture.clone().sub(anchor) : capture;
  const center = [f(attribute.x), f(attribute.y), f(attribute.z)];
  const camera = new THREE.PerspectiveCamera(
    FOV_DEG,
    WIDTH_PX / HEIGHT_PX,
    0.1,
    1e8,
  );
  const step = new THREE.Vector3(0.6, 0.2, -0.77)
    .normalize()
    .multiplyScalar(1e-3);
  const offset = new THREE.Vector3(0.4, 0.5, 0.75)
    .normalize()
    .multiplyScalar(viewM);
  let staticPx = 0;
  let jitterPx = 0;
  let last: [number, number] | null = null;
  for (let frame = 0; frame < 200; frame++) {
    camera.position.copy(capture).add(offset).addScaledVector(step, frame);
    camera.lookAt(capture.clone().addScaledVector(step, frame * 0.37));
    camera.updateMatrixWorld(true);
    // three multiplies view and model in 64 bits, then uploads 32.
    const mv64 = camera.matrixWorldInverse.clone().multiply(model);
    const mv32 = new Float32Array(mv64.elements);
    const exact = capture.clone().applyMatrix4(camera.matrixWorldInverse);
    const [ex, ey] = pixelOf([exact.x, exact.y, exact.z]);
    const [gx, gy] = pixelOf(mulGpu(mv32, center));
    const err: [number, number] = [gx - ex, gy - ey];
    staticPx = Math.max(staticPx, Math.hypot(...err));
    if (last !== null)
      jitterPx = Math.max(
        jitterPx,
        Math.hypot(err[0] - last[0], err[1] - last[1]),
      );
    last = err;
  }
  return { staticPx, jitterPx };
}

const DISTANCES_KM = [0, 10, 100, 1000, 3000, 8000, 15000];
const VIEWS_M = [30, 300];
/** How far the drawn capture is from the anchor: a short walk, a long one. */
const WALKS_M = [40, 5000];

describe("the debug layer's precision far from the tour's frame", () => {
  it("measures the error in px across the distance, direct against relative", () => {
    const rows = DISTANCES_KM.flatMap((km) =>
      VIEWS_M.flatMap((viewM) => {
        const direct = screenError(km * 1000, viewM, false, 0);
        return WALKS_M.map((walkM) => ({
          km,
          viewM,
          walkM,
          direct,
          relative: screenError(km * 1000, viewM, true, walkM),
        }));
      }),
    );
    console.log(
      rows
        .map(
          (r) =>
            `${String(r.km)} km, ${String(r.viewM)} m away, walk ${String(r.walkM)} m: direct ${r.direct.staticPx.toFixed(3)} px (jitter ${r.direct.jitterPx.toFixed(3)}), relative ${r.relative.staticPx.toFixed(4)} px (jitter ${r.relative.jitterPx.toFixed(4)})`,
        )
        .join("\n"),
    );
    // Relative: under a tenth of a pixel everywhere, still or moving.
    for (const r of rows) {
      expect(r.relative.staticPx).toBeLessThan(0.1);
      expect(r.relative.jitterPx).toBeLessThan(0.1);
    }
    // Direct: visible jitter at the far end (what the anchor removes).
    const far = rows.find((r) => r.km === 8000 && r.viewM === 30);
    expect(far?.direct.jitterPx).toBeGreaterThan(1);
  });
});
