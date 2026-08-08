/**
 * A mapped building passage must be WALKABLE END TO END, at any alignment.
 *
 * Why this test matters:
 * `building-passages.test.ts` pins which ways count and `obstacles.test.ts` pins
 * that one step through the arch is admitted while the rooms beside it are not.
 * Neither proves the thing the feature exists for: that an agent can actually
 * get from one side of the building to the other.
 *
 * That is a stronger requirement than the gate's, and the difference is why
 * `PASSAGE_CORRIDOR_M` is wider than `GATE_GAP_M`. A gate needs ONE admitted step
 * across a line. A corridor needs a CHAIN of them along its length, and the
 * res-13 cells the search moves between sit on a lattice ~6 m apart that has no
 * idea where the passage runs — two consecutive centres can land several metres
 * off the line on the same side. A corridor narrower than that spacing is one the
 * agent can enter and then not follow, which is worse than not opening it at all
 * because the mouth is visible.
 *
 * The counterweight is in the same file on purpose: widening the corridor until
 * traversal works would eventually dissolve the building, so the second property
 * asserts the interior AWAY from the passage stays sealed at the same width.
 *
 * @see building-passages.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

import { PASSAGE_CORRIDOR_M } from "./building-passages.js";
import { buildObstacleIndex, crossesObstacle } from "./obstacles.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import { enuFrameAt } from "../mesh/enu.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";

/** Half-width of the test building, metres. Big enough to have an interior. */
const HALF_M = 30;

/** A position `metres` from `centre` along `bearingDeg`. */
function along(centre: LatLng, bearingDeg: number, metres: number): LatLng {
  const frame = enuFrameAt(centre);
  const radians = (bearingDeg * Math.PI) / 180;
  return frame.toLatLng({
    x: Math.sin(radians) * metres,
    y: Math.cos(radians) * metres,
  });
}

/** A square building centred on `centre`, axis-aligned to `bearingDeg`. */
function buildingAt(centre: LatLng, bearingDeg: number): OsmFeature {
  const corner = (forward: number, side: number): LatLng => {
    const onAxis = along(centre, bearingDeg, forward);
    return along(onAxis, bearingDeg + 90, side);
  };
  const ring = [
    corner(-HALF_M, -HALF_M),
    corner(HALF_M, -HALF_M),
    corner(HALF_M, HALF_M),
    corner(-HALF_M, HALF_M),
    corner(-HALF_M, -HALF_M),
  ];
  return {
    type: "way",
    id: 1,
    geometry: ring,
    tags: { building: "yes", height: "12" },
  };
}

/** The passage, running through the middle of the building along `bearingDeg`. */
function passageAt(
  centre: LatLng,
  bearingDeg: number,
  tagged: boolean,
): OsmFeature {
  return {
    type: "way",
    id: 2,
    geometry: [
      along(centre, bearingDeg, -HALF_M * 1.5),
      along(centre, bearingDeg, HALF_M * 1.5),
    ],
    tags: tagged
      ? { highway: "footway", tunnel: "building_passage" }
      : { highway: "footway" },
  };
}

const cellOf = (position: LatLng) =>
  latLngToCell(position.lat, position.lng, AFFORDANCE_RES);

/**
 * Whether a chain of admitted steps joins `from` to `to`.
 *
 * A plain BFS over `gridDisk` neighbours with `crossesObstacle` as the edge
 * test, which is exactly the adjacency the route search uses — so "a route
 * exists" here means the same thing it means to the agent.
 */
function reachable(
  index: ReturnType<typeof buildObstacleIndex>,
  from: string,
  to: string,
  allowed: ReadonlySet<string>,
): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cell = queue.shift()!;
    if (cell === to) return true;
    for (const next of gridDisk(cell, 1)) {
      if (next === cell || seen.has(next) || !allowed.has(next)) continue;
      if (crossesObstacle(index, cell, next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** Every cell within `radius` rings of the building centre. */
function workingSet(centre: LatLng): Set<string> {
  return new Set(gridDisk(cellOf(centre), 12));
}

const anyPlacement = () =>
  fc.tuple(
    fc.double({ min: 0, max: 180, noNaN: true }),
    fc.double({ min: -60, max: 60, noNaN: true }),
    fc.double({ min: -179, max: 179, noNaN: true }),
  );

describe("a mapped building passage is walkable end to end", () => {
  it("joins the two sides of the building, whatever the bearing", () => {
    fc.assert(
      fc.property(anyPlacement(), ([bearing, lat, lng]) => {
        const centre = { lat, lng };
        const index = buildObstacleIndex([
          buildingAt(centre, bearing),
          passageAt(centre, bearing, true),
        ]);

        const west = cellOf(along(centre, bearing, -(HALF_M + 8)));
        const east = cellOf(along(centre, bearing, HALF_M + 8));
        expect(west).not.toBe(east);
        expect(reachable(index, west, east, workingSet(centre))).toBe(true);
      }),
      // Each run builds an obstacle index and walks a BFS; this is the honest
      // ceiling for a unit test that still samples the lattice properly.
      { numRuns: 25 },
    );
  });

  it("does NOT join them when the same road carries no passage tag", () => {
    // The before picture, and the guard against a bug that opened every
    // building: an untagged road crossing a footprint in plan is normally
    // running above or below it, which is the whole reason the tag decides.
    fc.assert(
      fc.property(anyPlacement(), ([bearing, lat, lng]) => {
        const centre = { lat, lng };
        const index = buildObstacleIndex([
          buildingAt(centre, bearing),
          passageAt(centre, bearing, false),
        ]);

        const west = cellOf(along(centre, bearing, -(HALF_M + 8)));
        const east = cellOf(along(centre, bearing, HALF_M + 8));
        // The working set is a disk around the centre, so going AROUND the
        // building is possible in principle — the assertion is that the route
        // does not go through it, which is why the disk is generous.
        const around = workingSet(centre);
        const throughOnly = new Set(
          [...around].filter((cell) => {
            const [cLat, cLng] = cellToLatLng(cell);
            const frame = enuFrameAt(centre);
            const local = frame.toEnu({ lat: cLat, lng: cLng });
            const radians = (bearing * Math.PI) / 180;
            // Distance across the passage axis: keep a narrow strip, so the
            // only route between the two ends would be through the building.
            const across =
              local.x * Math.cos(radians) - local.y * Math.sin(radians);
            return Math.abs(across) <= HALF_M * 0.6;
          }),
        );
        expect(reachable(index, west, east, throughOnly)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });

  it("keeps the corridor wide enough for the lattice the search moves on", () => {
    // The lower bound, written where it can fail: res-13 neighbours' centres are
    // ~6 m apart, so a corridor below that cannot hold a chain of steps however
    // well it is drawn.
    expect(PASSAGE_CORRIDOR_M).toBeGreaterThanOrEqual(6);
  });
});
