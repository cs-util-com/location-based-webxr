/**
 * A mapped building passage must be WALKABLE END TO END, at any alignment.
 *
 * Why this test matters:
 * `building-passages.test.ts` pins which ways count and `obstacles.test.ts` pins
 * that one step through the arch is admitted while the rooms beside it are not.
 * Neither proves the thing the feature exists for: that an agent can actually
 * get from one side of the building to the other.
 *
 * A gate needs ONE admitted step across a line; a corridor needs a CHAIN of them
 * along its length, on a res-13 lattice (centres 7.1 m apart on average, up to
 * 7.83 m) that has no idea where the passage runs. Measured, the chain does NOT
 * depend on `PASSAGE_CORRIDOR_M`: a step is admitted when it comes within half
 * the corridor of the passage line ANYWHERE along its length, so every step
 * that crosses the line is admitted at any width, and the lattice edges a line
 * crosses always form a connected zigzag. Over 300 uniform and 300 near-axis
 * placements, with buildings 6, 16 and 60 m deep, widths from 0 to 12 m all
 * joined the two sides every time.
 *
 * What the width DOES decide is how much of the building opens, so the
 * counterweights are in the same file on purpose: an untagged road joins
 * nothing, and with a tagged one the rooms well away from the passage stay
 * sealed. That last property is the one that bounds the width.
 *
 * Both reachability checks are confined to a strip through the building. With
 * the whole disk around it the agent could walk round the outside, and the
 * first property passed with no passage tag at all.
 *
 * @see building-passages.ts.md
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

import { buildObstacleIndex, crossesObstacle } from "./obstacles.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import { enuFrameAt } from "../mesh/enu.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { uniformIn } from "../test-utils/uniform-arbitrary.js";

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
 * Every cell a chain of admitted steps reaches from `from`, within `allowed`.
 *
 * A plain BFS over `gridDisk` neighbours with `crossesObstacle` as the edge
 * test, which is exactly the adjacency the route search uses — so "a route
 * exists" here means the same thing it means to the agent.
 */
function reachedFrom(
  index: ReturnType<typeof buildObstacleIndex>,
  from: string,
  allowed: ReadonlySet<string>,
): Set<string> {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cell = queue.shift()!;
    for (const next of gridDisk(cell, 1)) {
      if (next === cell || seen.has(next) || !allowed.has(next)) continue;
      if (crossesObstacle(index, cell, next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Whether a chain of admitted steps joins `from` to `to`. */
function reachable(
  index: ReturnType<typeof buildObstacleIndex>,
  from: string,
  to: string,
  allowed: ReadonlySet<string>,
): boolean {
  return reachedFrom(index, from, allowed).has(to);
}

/** A cell's position in the building's frame: along and across the passage. */
function passageFrame(
  centre: LatLng,
  bearing: number,
  cell: string,
): { along: number; across: number } {
  const [cLat, cLng] = cellToLatLng(cell);
  const local = enuFrameAt(centre).toEnu({ lat: cLat, lng: cLng });
  const radians = (bearing * Math.PI) / 180;
  return {
    along: local.x * Math.sin(radians) + local.y * Math.cos(radians),
    across: local.x * Math.cos(radians) - local.y * Math.sin(radians),
  };
}

/** Every cell within `radius` rings of the building centre. */
function workingSet(centre: LatLng): Set<string> {
  return new Set(gridDisk(cellOf(centre), 12));
}

/**
 * The cells of `workingSet` in a strip along the passage axis, narrower than
 * the building, so the only way from one end to the other is THROUGH it.
 *
 * Both properties need it. With the whole disk the agent can walk round the
 * building, and the "joins the two sides" property then passed with no passage
 * tag at all: measured over 100 uniform placements, an untagged road joined the
 * sides round the outside every time.
 */
function throughOnly(centre: LatLng, bearing: number): Set<string> {
  return new Set(
    [...workingSet(centre)].filter(
      (cell) =>
        Math.abs(passageFrame(centre, bearing, cell).across) <= HALF_M * 0.6,
    ),
  );
}

/** Uniform over the range, not `fc.double`: see `uniform-arbitrary.ts`. */
const anyPlacement = () =>
  fc.tuple(uniformIn(0, 180), uniformIn(-60, 60), uniformIn(-179, 179));

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
        expect(reachable(index, west, east, throughOnly(centre, bearing))).toBe(
          true,
        );
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
        expect(reachable(index, west, east, throughOnly(centre, bearing))).toBe(
          false,
        );
      }),
      { numRuns: 25 },
    );
  });

  it("keeps the rooms away from the passage sealed", () => {
    // THE COUNTERWEIGHT THAT BOUNDS THE WIDTH. Walkability holds at any
    // corridor width (see the header), so nothing above stops the constant
    // from growing until the passage swallows the building. Here the whole
    // disk is open, so the agent may enter by the passage and wander: no cell
    // inside the footprint more than 15 m off the passage may be reached.
    // Measured: 10 m and 14 m reach none, 16 m reaches them in about one
    // placement in six, 20 m in most.
    fc.assert(
      fc.property(anyPlacement(), ([bearing, lat, lng]) => {
        const centre = { lat, lng };
        const index = buildObstacleIndex([
          buildingAt(centre, bearing),
          passageAt(centre, bearing, true),
        ]);

        const west = cellOf(along(centre, bearing, -(HALF_M + 8)));
        const reached = reachedFrom(index, west, workingSet(centre));
        // Sanity: the agent did get in, or "sealed" would be vacuous.
        expect(reached.has(cellOf(centre))).toBe(true);
        const intoRooms = [...reached].filter((cell) => {
          const at = passageFrame(centre, bearing, cell);
          return (
            Math.abs(at.along) < HALF_M - 1 &&
            Math.abs(at.across) > 15 &&
            Math.abs(at.across) < HALF_M - 1
          );
        });
        expect(intoRooms).toEqual([]);
      }),
      { numRuns: 25 },
    );
  });
});
