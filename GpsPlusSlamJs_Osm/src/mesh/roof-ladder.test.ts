/**
 * `buildRoof`'s ladder when a rung throws something other than a
 * `SkeletonFailure`.
 *
 * Why this file matters: the ladder exists so that one footprint the skeleton
 * cannot settle still gets the best roof left. An unforeseen error (a bug, a
 * `TypeError` from data nobody anticipated) in one rung used to escape the
 * whole ladder, so the box rung was never tried and a near-rectangle that the
 * box roof fits became a prism (M2 review finding 6, 2026-11-08). The error
 * is injected by mocking `skeletonMesh`, because no known footprint throws
 * anything but `SkeletonFailure` today; this pins what happens when one does.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnuPoint } from "./enu.js";
import type * as SkeletonMeshModule from "./skeleton-mesh.js";
import type { RoofShape } from "./building-heights.js";
import type { RoofMesh } from "./roof.js";
import { buildRoof } from "./roof.js";
import { triangulate } from "./triangulate.js";

/** How many `skeletonMesh` calls still throw an unforeseen error. */
const failing = vi.hoisted(() => ({ calls: 0 }));

vi.mock("./skeleton-mesh.js", async (importOriginal) => {
  const real = await importOriginal<typeof SkeletonMeshModule>();
  return {
    ...real,
    skeletonMesh: (...args: Parameters<typeof real.skeletonMesh>) => {
      if (failing.calls > 0) {
        failing.calls -= 1;
        throw new TypeError("an unforeseen error");
      }
      return real.skeletonMesh(...args);
    },
  };
});

const roofOf = (ring: EnuPoint[], shape: RoofShape): RoofMesh =>
  buildRoof([ring], triangulate([ring]), {
    shape,
    eaveHeightM: 6,
    ridgeHeightM: 11,
  });

const L_SHAPE: EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 14, y: 0 },
  { x: 14, y: 6 },
  { x: 6, y: 6 },
  { x: 6, y: 14 },
  { x: 0, y: 14 },
];

/** 3 % short of its 20 x 10 m rectangle, within the 1 m overhang limit. */
const NOTCHED: EnuPoint[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 15, y: 10 },
  { x: 15, y: 9.4 },
  { x: 5, y: 9.4 },
  { x: 5, y: 10 },
  { x: 0, y: 10 },
];

describe("buildRoof: an unforeseen error in one rung", () => {
  beforeEach(() => {
    failing.calls = 0;
  });

  it("goes on to the next skeleton rung", () => {
    failing.calls = 1;
    const roof = roofOf(L_SHAPE, "gabled");
    expect(roof.method).toBe("hipped-skeleton");
    expect(roof.isApproximate).toBe(true);
  });

  it("still reaches the box roof when every skeleton rung throws", () => {
    failing.calls = Number.POSITIVE_INFINITY;
    const roof = roofOf(NOTCHED, "gabled");
    expect(roof.method).toBe("box-fallback");
    expect(roof.isApproximate).toBe(true);
  });

  it("draws the tagged skeleton when nothing throws", () => {
    // The control: the two footprints above are skeleton roofs untouched.
    expect(roofOf(L_SHAPE, "gabled").method).toBe("skeleton");
    expect(roofOf(NOTCHED, "gabled").method).toBe("skeleton");
  });
});
