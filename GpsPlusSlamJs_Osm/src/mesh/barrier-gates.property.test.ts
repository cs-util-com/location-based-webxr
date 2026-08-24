/**
 * A mapped gate must be WALKABLE, at any alignment.
 *
 * Why this test matters:
 * `barrier-gates.test.ts` pins the geometry — the gap is opened, it is centred
 * on the node, it merges with its neighbours. None of that proves the thing the
 * feature exists for. Blocking is a property of the STEP between two res-13 cell
 * centres (`nav/obstacles.ts`), so a gap narrower than the ~6 m spacing of those
 * centres can be drawn, look right, and still have no step through it — a
 * visible opening the agent walks around, which is the worst of both outcomes
 * and would read as a pathfinding bug rather than as a width constant.
 *
 * `GATE_GAP_M` is therefore justified HERE rather than by the "typical gate is
 * 3-5 m" argument alone: the property is "for any bearing and any position on
 * the H3 lattice, some step crosses the wall at the gate", and the constant is
 * whatever makes that true. The counterweight test — that the wall still blocks
 * away from the gate — is what stops the constant simply growing until nothing
 * blocks at all.
 *
 * @see barrier-gates.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

import { GATE_GAP_M } from "./barrier-gates.js";
import { DEFAULT_BARRIER_THICKNESS_M } from "./barriers.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import { buildObstacleIndex, crossesObstacle } from "../nav/obstacles.js";
import { enuFrameAt } from "./enu.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";

/** Half the length of every test wall, metres. Long enough to have a far end. */
const WALL_HALF_M = 40;

/** A position `metres` from `centre` along `bearingDeg`. */
function along(centre: LatLng, bearingDeg: number, metres: number): LatLng {
  const frame = enuFrameAt(centre);
  const radians = (bearingDeg * Math.PI) / 180;
  return frame.toLatLng({
    x: Math.sin(radians) * metres,
    y: Math.cos(radians) * metres,
  });
}

/** A straight wall through `centre`, with a vertex exactly at the centre. */
function wallThrough(centre: LatLng, bearingDeg: number): readonly LatLng[] {
  return [
    along(centre, bearingDeg, -WALL_HALF_M),
    centre,
    along(centre, bearingDeg, WALL_HALF_M),
  ];
}

function features(
  wall: readonly LatLng[],
  gateAt: LatLng | undefined,
): OsmFeature[] {
  const list: OsmFeature[] = [
    { type: "way", id: 1, geometry: wall, tags: { barrier: "wall" } },
  ];
  if (gateAt !== undefined) {
    list.push({
      type: "node",
      id: 2,
      position: gateAt,
      tags: { barrier: "gate" },
    });
  }
  return list;
}

/** Whether the segment `a`→`b` crosses the wall's centreline, ignoring gaps. */
function straddles(a: LatLng, b: LatLng, wall: readonly LatLng[]): boolean {
  const side = (p: LatLng, q: LatLng, r: LatLng) =>
    (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
  const from = wall[0]!;
  const to = wall[wall.length - 1]!;
  const d1 = side(from, to, a);
  const d2 = side(from, to, b);
  const d3 = side(a, b, from);
  const d4 = side(a, b, to);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/**
 * Whether a step actually passes THROUGH the wall rather than along inside it.
 *
 * **Only the "must be blocked" properties may use this, and the distinction is
 * the whole point.** A wall is `DEFAULT_BARRIER_THICKNESS_M` wide, and at some
 * alignments both res-13 cell centres of a step land inside that 0.5 m band. The
 * step then runs along the INSIDE of the wall, grazing the zero-width centreline
 * by a floating-point sliver while never crossing the wall's boundary —
 * `(-0.18, 21.71) → (0.00, 15.23)` metres against a band of x ∈ [−0.25, +0.25]
 * was the case that failed. Nothing blocks it and nothing should:
 * `segmentCrossesRing` is false for a segment lying wholly inside a ring, the
 * same property `obstacles.ts` documents for building interiors.
 *
 * It is harmless because the band is SEALED. Measured for that wall: 3 cell
 * centres fall inside it and **0** steps from outside reach any of them, so no
 * agent can ever stand at such a step's start.
 *
 * **Why NOT in `straddles` itself:** at a gate the wall is absent, so a cell
 * centre within 0.25 m of the centreline is legitimately walkable and the step
 * through it is a genuine crossing — exactly the step the "a gate is walkable"
 * property needs to find. Excluding it there deleted the evidence that property
 * exists to check, which is how the first attempt at this fix broke that test.
 */
function passesThroughWall(
  a: LatLng,
  b: LatLng,
  wall: readonly LatLng[],
): boolean {
  return clearsWallThickness(a, wall) && clearsWallThickness(b, wall);
}

/** Whether `p` lies outside the wall's own 0.5 m band, measured in metres. */
function clearsWallThickness(p: LatLng, wall: readonly LatLng[]): boolean {
  const from = wall[0]!;
  const to = wall[wall.length - 1]!;
  const frame = enuFrameAt(from);
  const end = frame.toEnu(to);
  const point = frame.toEnu(p);
  const length = Math.hypot(end.x, end.y);
  if (length === 0) return true;
  const perpendicular = Math.abs(point.x * end.y - point.y * end.x) / length;
  return perpendicular > DEFAULT_BARRIER_THICKNESS_M / 2;
}

/** Adjacent cell pairs within `radius` of `centre`, as [from, to]. */
function neighbourPairs(centre: LatLng, radius: number): [string, string][] {
  const home = latLngToCell(centre.lat, centre.lng, AFFORDANCE_RES);
  const pairs: [string, string][] = [];
  for (const from of gridDisk(home, radius)) {
    for (const to of gridDisk(from, 1)) {
      if (from !== to) pairs.push([from, to]);
    }
  }
  return pairs;
}

function asLatLng(cell: string): LatLng {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

describe("a mapped gate is walkable", () => {
  it("always leaves at least one step through it, whatever the bearing", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 180, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (bearing, lat, lng) => {
          const centre = { lat, lng };
          const wall = wallThrough(centre, bearing);
          const index = buildObstacleIndex(features(wall, centre));

          // Only steps that actually cross the wall are candidates; a step
          // running parallel to it proves nothing.
          const crossing = neighbourPairs(centre, 2).filter(([from, to]) =>
            straddles(asLatLng(from), asLatLng(to), wall),
          );
          expect(crossing.length).toBeGreaterThan(0);

          const open = crossing.filter(
            ([from, to]) => !crossesObstacle(index, from, to),
          );
          expect(open.length).toBeGreaterThan(0);
        },
      ),
      // Enough alignments to sample the lattice properly; the body builds an
      // obstacle index per run, so this is the honest ceiling for a unit test.
      { numRuns: 40 },
    );
  });

  it("still blocks every crossing step at the FAR END of the same wall", () => {
    // THE COUNTERWEIGHT, and the reason the test above cannot be satisfied by
    // simply widening the gap until nothing blocks. A gate opens a gate-sized
    // hole; thirty metres away the wall is exactly as solid as it was.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 180, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (bearing, lat, lng) => {
          const centre = { lat, lng };
          const wall = wallThrough(centre, bearing);
          const index = buildObstacleIndex(features(wall, centre));

          const farEnd = along(centre, bearing, WALL_HALF_M / 2);
          for (const [from, to] of neighbourPairs(farEnd, 0)) {
            const a = asLatLng(from);
            const b = asLatLng(to);
            if (!straddles(a, b, wall)) continue;
            if (!passesThroughWall(a, b, wall)) continue;
            expect(crossesObstacle(index, from, to)).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("blocks at the gate position too when NO gate is mapped", () => {
    // The before picture, stated as a property rather than assumed: without the
    // node, the same wall in the same place has no step through it anywhere.
    // Without this, a bug that opened every wall would pass the test above.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 180, noNaN: true }),
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -179, max: 179, noNaN: true }),
        (bearing, lat, lng) => {
          const centre = { lat, lng };
          const wall = wallThrough(centre, bearing);
          const index = buildObstacleIndex(features(wall, undefined));

          for (const [from, to] of neighbourPairs(centre, 1)) {
            const a = asLatLng(from);
            const b = asLatLng(to);
            if (!straddles(a, b, wall)) continue;
            if (!passesThroughWall(a, b, wall)) continue;
            expect(crossesObstacle(index, from, to)).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("keeps the gap comparable to the step length it has to admit", () => {
    // The constant's lower bound, written down where it can fail. A res-13 cell
    // is ~8 m across and its neighbours' centres are ~6 m away, so a gap far
    // below that is one the search cannot use however well it is drawn.
    expect(GATE_GAP_M).toBeGreaterThanOrEqual(4);
  });
});
