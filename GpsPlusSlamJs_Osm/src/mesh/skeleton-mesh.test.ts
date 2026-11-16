import { describe, expect, it } from "vitest";

import type { SkeletonFace, SkeletonRoof } from "./roof-skeleton.js";
import { SkeletonFailure } from "./roof-skeleton.js";
import { skeletonMesh } from "./skeleton-mesh.js";

/**
 * How far the cluster weld may move a corner.
 *
 * WHY THIS TEST MATTERS. The second stitch welds raised corners in clusters:
 * every chain of corners less than the weld distance apart becomes one
 * corner, drawn at the highest. A chain has no length limit, so a long run of
 * nearby events would pull a corner centimetres away and the roof would be
 * drawn as another shape than the skeleton's. The weld is bounded: a corner
 * that would move more than a few weld distances refuses the roof
 * (`SkeletonFailure`), so the caller's next rung (another roof, or a lid)
 * follows instead.
 *
 * The roofs are built by hand: an n-gon pyramid whose faces each meet at
 * their own apex, the apexes a chain 2.9 mm apart (just under the 3 mm weld),
 * so the nearest-corner stitch splits them and only the cluster stitch can
 * close the roof.
 */

const CHAIN_STEP_M = 0.0029;

function pyramid(n: number): SkeletonRoof {
  const radius = 5;
  const corner = (i: number) => {
    const angle = (2 * Math.PI * (i % n)) / n;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), t: 0 };
  };
  const faces: SkeletonFace[] = Array.from({ length: n }, (_, i) => {
    const a = corner(i);
    const b = corner(i + 1);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    // The apex of face i, and of the next face's start: a chain along x.
    const apex = { x: i * CHAIN_STEP_M, y: 0, t: 3 };
    return {
      ring: 0,
      wall: i,
      vertical: false,
      weight: 1,
      nx: -dy,
      ny: dx,
      dx,
      dy,
      points: [a, b, apex],
    };
  });
  return { faces, caps: [], ridgeT: 3, gables: 0 };
}

const HEIGHTS = { eaveM: 0, slope: 1 } as const;

describe("skeletonMesh, the cluster weld", () => {
  it("closes a pyramid whose apex chain is short, drawing it as one apex", () => {
    // 3 links: the far apex moves 8.7 mm.
    const { mesh } = skeletonMesh(pyramid(4), HEIGHTS);
    const tops = new Set<string>();
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if ((mesh.positions[i + 1] as number) > 2.5) {
        tops.add(`${mesh.positions[i]},${mesh.positions[i + 2]}`);
      }
    }
    expect(tops.size).toBe(1);
  });

  it("refuses a pyramid whose apex chain would move a corner too far", () => {
    // 15 links: the far apex would move 43.5 mm, over 14 weld distances.
    expect(() => skeletonMesh(pyramid(16), HEIGHTS)).toThrow(SkeletonFailure);
  });
});
