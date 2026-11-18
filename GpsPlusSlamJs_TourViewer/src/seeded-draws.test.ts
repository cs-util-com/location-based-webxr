/**
 * Why these tests matter: the optimizer check's test files, the sampled
 * surface distance, the picture plate's grain and the narration motes are
 * all drawn from one seeded generator, and the same seed must keep giving
 * the same output (a sweep compares like with like, the same model gets
 * the same default level). These pins hold the exact outputs, so a change
 * to the generator's arithmetic shows up here rather than as a quiet drift.
 * The optimizer check and the surface distance are pinned through their
 * call sites; the grain and the motes only through the generator with
 * their seeds, so a changed seed at either call site is not caught here.
 */
import { createHash } from "node:crypto";

import { mulberry32 } from "gps-plus-slam-app-framework/utils/mulberry32";
import { describe, expect, it } from "vitest";

import {
  testPicturePixels,
  testSoundPlanes,
} from "./checks/asset-optimizer-check.js";
import { surfaceDistance } from "./editor/asset-shelf/mesh-distance.js";
import { sphere } from "./editor/asset-shelf/test-support/meshes.js";

const hash = (a: ArrayBufferView) =>
  createHash("sha256")
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest("hex")
    .slice(0, 16);

describe("seeded outputs", () => {
  it("the optimizer check's test picture and sound are pinned for a seed", () => {
    expect(hash(testPicturePixels(32, 24, 7))).toBe("d975aedce0ad4af5");
    expect(hash(testSoundPlanes("speech", 0.05, 8000, 2)[0]!)).toBe(
      "3a4ad4b7ae61b8d5",
    );
  });

  it("the sampled surface distance is pinned for a seed", () => {
    const a = sphere(2);
    const b = sphere(2, 1.1);
    const d = surfaceDistance(
      a.positions,
      a.indices,
      b.positions,
      b.indices,
      500,
    );
    // Not an exact-double pin: the areas and spacing go through Math.hypot
    // and Math.cbrt, which the spec lets an engine approximate, so the last
    // bits may differ between engines. 14 digits (|diff| < 5e-15) leaves
    // hundreds of ulps of room for that, and still fails on a changed draw:
    // shifting any one of the 3000 draws by 0.37 or by 0.01 either left both
    // values bit-identical (a draw this symmetric mesh does not feel, which
    // an exact pin cannot see either) or moved one by more than 5e-15; none
    // landed in between. Only nudges far below a real change (1e-6 to one
    // draw) can move a value by less, by amounts as small as engine drift.
    expect(d.mean).toBeCloseTo(0.09584936281907831, 14);
    expect(d.max).toBeCloseTo(0.09790887828748089, 14);
  });

  it("the plate grain's and the motes' seeds draw the pinned sequence", () => {
    // picture-paint.ts seeds its grain with 3, narration-look.ts its motes
    // with 17; both are drawn in a canvas or a shader and neither module
    // exports its draws, so this pins the generator at those two seeds, not
    // the call sites themselves.
    const grain = mulberry32(3);
    expect([grain(), grain(), grain()]).toEqual([
      0.7202267837710679, 0.03866216051392257, 0.4561921926215291,
    ]);
    const motes = mulberry32(17);
    expect([motes(), motes(), motes()]).toEqual([
      0.6771502960473299, 0.19265692122280598, 0.5313839064911008,
    ]);
  });
});
