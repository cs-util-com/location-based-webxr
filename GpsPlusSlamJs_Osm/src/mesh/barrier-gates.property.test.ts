/**
 * A mapped gate must be WALKABLE, at any alignment.
 *
 * Why this test matters:
 * `barrier-gates.test.ts` pins the geometry — the gap is opened, it is centred
 * on the node, it merges with its neighbours. None of that proves the thing the
 * feature exists for. Blocking is a property of the STEP between two res-13 cell
 * centres (`nav/obstacles.ts`), so a gap narrower than the spacing of those
 * centres (up to 7.83 m) can be drawn, look right, and still have no step through it — a
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
import { uniformIn } from "../test-utils/uniform-arbitrary.js";

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

/** Whether some step across the wall at the gate is left open by the index. */
function openStepsThroughGate(centre: LatLng, bearing: number): number {
  const wall = wallThrough(centre, bearing);
  const index = buildObstacleIndex(features(wall, centre));
  // Only steps that actually cross the wall are candidates; a step
  // running parallel to it proves nothing.
  const crossing = neighbourPairs(centre, 2).filter(([from, to]) =>
    straddles(asLatLng(from), asLatLng(to), wall),
  );
  expect(crossing.length).toBeGreaterThan(0);
  return crossing.filter(([from, to]) => !crossesObstacle(index, from, to))
    .length;
}

describe("a mapped gate is walkable", () => {
  it("always leaves at least one step through it, whatever the bearing", () => {
    fc.assert(
      fc.property(
        uniformIn(0, 180),
        uniformIn(-60, 60),
        uniformIn(-179, 179),
        (bearing, lat, lng) => {
          expect(openStepsThroughGate({ lat, lng }, bearing)).toBeGreaterThan(
            0,
          );
        },
      ),
      // Enough alignments to sample the lattice properly; the body builds an
      // obstacle index per run, so this is the honest ceiling for a unit test.
      { numRuns: 40 },
    );
  });

  it.each([
    // The counterexample CI found: a north-south wall on the equator, where
    // the lattice column runs almost exactly along the wall half a metre
    // off it. Every crossing step then crosses within ~0.3 m of a cell of
    // that column, so the crossings come ~7.3 m apart and a 6 m gap fell
    // between two of them.
    { lat: 0, lng: -21.50740182082131, bearing: 0 },
    // A near-aligned case found by sweeping bearings within 2 degrees of a
    // lattice axis: a 7.5 m gap still left no step here, which is why the
    // constant had to clear the largest res-13 centre spacing (7.83 m) and
    // not merely the typical one.
    {
      lat: 45.00559122496986,
      lng: 75.68412896246906,
      bearing: 125.2889612306924,
    },
  ])(
    "leaves a step through the gate at $lat, $lng, bearing $bearing",
    ({ lat, lng, bearing }) => {
      // Why this test matters: these are fixed alignments at which the gate
      // used to open a gap no step of the search could use, so the agent
      // walked around a visible opening. The property above samples
      // alignments at random; these pin the two that are known to bite.
      expect(openStepsThroughGate({ lat, lng }, bearing)).toBeGreaterThan(0);
    },
  );

  it("still blocks every crossing step at the FAR END of the same wall", () => {
    // THE COUNTERWEIGHT, and the reason the test above cannot be satisfied by
    // simply widening the gap until nothing blocks. A gate opens a gate-sized
    // hole; thirty metres away the wall is exactly as solid as it was.
    fc.assert(
      fc.property(
        uniformIn(0, 180),
        uniformIn(-60, 60),
        uniformIn(-179, 179),
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
        uniformIn(0, 180),
        uniformIn(-60, 60),
        uniformIn(-179, 179),
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

  it("keeps the gap wider than the largest step it has to admit", () => {
    // The constant's lower bound, written down where it can fail. Res-13
    // neighbour centres are up to 7.83 m apart (measured over 20 000 random
    // cells and a global grid), and a wall along a lattice axis is crossed
    // only one such spacing apart, so a narrower gap can miss every step.
    expect(GATE_GAP_M).toBeGreaterThan(7.83);
  });
});
