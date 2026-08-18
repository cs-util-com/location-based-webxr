/**
 * Barrier volume properties — the drawn wall and the indexed wall agree.
 *
 * Why these tests matter:
 * DEC-R11-11 draws barriers with the buildings and gives them no toggle and no
 * distinct colour, and its own reasoning is explicit that **the inspectability
 * this gives up has to come from tests instead** — you cannot isolate the
 * barrier layer on screen to check it, because there is no barrier layer.
 *
 * The drift these guard against is the expensive kind. `buildBarriers` and
 * `buildObstacleIndex` read the same tags through the same `resolveBarrier` and
 * the same `barrierCentrelines`, so today they cannot disagree — and that is
 * exactly the property worth pinning, because the two live in different
 * directories and nothing else would notice if one grew a special case. A drawn
 * wall that is not indexed is an agent walking through visible geometry; an
 * indexed wall that is not drawn is a detour around thin air.
 *
 * @see barrier-volumes.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { buildBarriers } from "./barrier-volumes.js";
import { enuFrameAt } from "./enu.js";
import { buildObstacleIndex } from "../nav/obstacles.js";
import type { OsmFeature } from "../model/osm-feature.js";

const HOME = { lat: 50.9413, lng: 6.9583 };
const FRAME = enuFrameAt(HOME);

/**
 * Ways near HOME, spanning a few res-13 cells at most.
 *
 * **SMALL ON PURPOSE.** `buildObstacleIndex` runs `coverCells` at res-13 (~8 m)
 * per quad, so a generated 400 m wall costs tens of thousands of cells and the
 * first draft of these properties timed out at 5 s. Nothing here is about
 * length: the properties are about tags, node counts and the agreement between
 * two modules, all of which a 20 m way exercises exactly as well.
 *
 * The tags vary across solid and passable values so the properties see both
 * the "produces something" and the "produces nothing" paths.
 */
const SPAN = 0.0001;

const barrierArb = fc
  .record({
    barrier: fc.constantFrom(
      "wall",
      "city_wall",
      "retaining_wall",
      "fence",
      "hedge",
      "gate",
      "kerb",
      "bollard",
    ),
    height: fc.option(fc.integer({ min: 1, max: 40 }), { nil: undefined }),
    width: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
    geometry: fc.array(
      fc.record({
        lat: fc.double({
          min: HOME.lat - SPAN,
          max: HOME.lat + SPAN,
          noNaN: true,
        }),
        lng: fc.double({
          min: HOME.lng - SPAN,
          max: HOME.lng + SPAN,
          noNaN: true,
        }),
      }),
      { minLength: 0, maxLength: 6 },
    ),
  })
  .map(({ barrier, height, width, geometry }): OsmFeature => {
    const tags: Record<string, string> = { barrier };
    if (height !== undefined) tags["height"] = String(height);
    if (width !== undefined) tags["width"] = String(width);
    return { type: "way", id: 1, geometry, tags };
  });

/** Every Y coordinate in a mesh — Y is up, per `extrude.ts`'s `addWalls`. */
const heightsOf = (positions: Float32Array): number[] => {
  const out: number[] = [];
  for (let i = 1; i < positions.length; i += 3) out.push(positions[i]!);
  return out;
};

describe("barrier volume properties", () => {
  it("draws exactly the barriers the index blocks", () => {
    // The headline invariant. Not "the same cells" — the two build their
    // footprints in different frames (the index anchors on the feature's own
    // first vertex, the mesh on the scene origin), so cell coverage can differ
    // by a hair at a boundary and asserting on it would be flaky for a reason
    // that is not a defect. What must never differ is WHETHER a feature
    // obstructs at all.
    fc.assert(
      fc.property(barrierArb, (feature) => {
        const drawn = buildBarriers([feature], { frame: FRAME }).length > 0;
        const indexed = buildObstacleIndex([feature]).cells.size > 0;
        expect(drawn).toBe(indexed);
      }),
    );
  });

  it("draws every barrier to the height the index records for it", () => {
    // A wall drawn 2 m tall and indexed at 8 m would look climbable and refuse
    // to be climbed, which is the most confusing possible pairing.
    fc.assert(
      fc.property(barrierArb, (feature) => {
        const volumes = buildBarriers([feature], { frame: FRAME });
        if (volumes.length === 0) return;

        const index = buildObstacleIndex([feature]);
        const cells = [...index.cells];
        const obstacle = index.obstaclesIn(cells[0]!)[0];

        expect(obstacle?.heightM).toBe(volumes[0]!.heightM);
      }),
    );
  });

  it("keeps every vertex between the ground and the barrier's height", () => {
    // Vertices outside that band mean the extrusion took a height from
    // somewhere other than `resolveBarrier` — which is how an untagged wall
    // would silently become a 0 m wall, drawn as a stripe on the ground.
    fc.assert(
      fc.property(barrierArb, fc.integer({ min: -50, max: 300 }), (f, base) => {
        const volumes = buildBarriers([f], {
          frame: FRAME,
          groundHeightM: () => base,
        });
        if (volumes.length === 0) return;

        const heights = heightsOf(volumes[0]!.mesh.positions);
        const top = base + volumes[0]!.heightM;
        // A float32 buffer at a 300 m base needs a tolerance in the tens of
        // micrometres; 1e-3 is far below any distinction that matters and far
        // above the representation error.
        expect(Math.min(...heights)).toBeGreaterThanOrEqual(base - 1e-3);
        expect(Math.max(...heights)).toBeLessThanOrEqual(top + 1e-3);
      }),
    );
  });
});
