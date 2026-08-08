/**
 * The obstacle index — what blocks an agent, and at what height.
 *
 * Why these tests matter:
 * This is pass B's half of the navigation design, and the design flags one
 * hazard about it specifically and twice: **the index must not be keyed in
 * ENU**, because `BuildingVolume.footprint` lives in a frame rebuilt on every
 * publish, so every recentre invalidates every coordinate in it. That hazard
 * has now appeared three times on this branch in different guises.
 *
 * Building the index from `OsmFeature` geometry — which is lat/lng, from
 * Overpass `out geom` — makes it structural rather than something to remember:
 * an ENU coordinate cannot enter, because none is ever in scope.
 *
 * The other thing pinned here is the pairing with `levelsAt`. An obstacle that
 * only ever *removes* levels would make a walled cell unstandable, and an agent
 * cannot walk beside a wall it is standing inside — so the ground level is
 * always offered alongside the wall top.
 *
 * **THINGS BLOCK NOW, and the last section is where.** This header used to say
 * the opposite, correctly: `obstacleLevelsAt` only ADDS a level, so an agent
 * got the wall top as an extra state and walked along the ground straight
 * through the wall. `crossesObstacle` is the slice that header named, and the
 * shape of the fix is worth keeping — **blocking had to become a property of
 * the STEP rather than of the cell.** At res-13 a cell is ~8 m across and a
 * wall ~0.5 m thick, so a wall contains a cell's centre about one time in
 * sixteen; any rule of the form "you may not stand in a walled cell" is
 * transparent to pathfinding the other fifteen.
 *
 * @see obstacles.ts.md
 */

import { describe, expect, it } from "vitest";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";

import {
  buildObstacleIndex,
  crossesObstacle,
  obstacleLevelsAt,
} from "./obstacles.js";
import { DEFAULT_BARRIER_HEIGHT_M } from "../mesh/barriers.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";
import type { OsmFeature, OsmWay } from "../model/osm-feature.js";

const HOME = { lat: 50.9413, lng: 6.9583 };

/** ~0.9 m of latitude — well inside one res-13 cell. */
const STEP = 0.000008;

// Typed as OsmWay, not OsmFeature: the tests read `.geometry` off it, which
// the union does not expose. The first draft reached it through an `as` cast,
// which is the same thing with the type checker switched off.
const wall = (tags: Record<string, string> = {}): OsmWay => ({
  type: "way",
  id: 1,
  geometry: [
    { lat: HOME.lat, lng: HOME.lng },
    { lat: HOME.lat, lng: HOME.lng + STEP * 40 },
  ],
  tags: { barrier: "wall", ...tags },
});

const cellAt = (lat: number, lng: number) =>
  latLngToCell(lat, lng, AFFORDANCE_RES);

describe("buildObstacleIndex", () => {
  it("indexes a barrier under the cells its footprint covers", () => {
    const index = buildObstacleIndex([wall()]);
    expect(index.obstaclesIn(cellAt(HOME.lat, HOME.lng)).length).toBe(1);
  });

  it("leaves cells the barrier does not reach empty", () => {
    // Without this, "indexed everywhere" and "indexed correctly" are the same
    // picture and the test above cannot tell them apart.
    const index = buildObstacleIndex([wall()]);
    expect(index.obstaclesIn(cellAt(HOME.lat + 0.01, HOME.lng))).toEqual([]);
  });

  it("ignores features that are not solid barriers", () => {
    const index = buildObstacleIndex([
      wall({ barrier: "gate" }),
      { type: "way", id: 2, geometry: wall().geometry, tags: {} },
    ]);
    expect(index.obstaclesIn(cellAt(HOME.lat, HOME.lng))).toEqual([]);
  });

  it("carries the resolved height, not a default one", () => {
    const tagged = buildObstacleIndex([wall({ height: "8" })]);
    const untagged = buildObstacleIndex([wall()]);

    expect(tagged.obstaclesIn(cellAt(HOME.lat, HOME.lng))[0]!.heightM).toBe(8);
    expect(untagged.obstaclesIn(cellAt(HOME.lat, HOME.lng))[0]!.heightM).toBe(
      DEFAULT_BARRIER_HEIGHT_M,
    );
  });

  it("holds no ENU coordinate anywhere", () => {
    // THE DESIGN'S NAMED HAZARD, asserted structurally. Every stored number is
    // a lat/lng degree or a height in metres — nothing is expressed relative to
    // an origin that a recentre could move. Degrees near Cologne are ~50 and
    // ~7; ENU metres would be tens to hundreds, so the magnitudes alone
    // separate the two.
    const index = buildObstacleIndex([wall({ height: "8" })]);
    const obstacle = index.obstaclesIn(cellAt(HOME.lat, HOME.lng))[0]!;

    for (const ring of obstacle.rings) {
      for (const vertex of ring) {
        expect(Math.abs(vertex.y - HOME.lat)).toBeLessThan(0.01);
        expect(Math.abs(vertex.x - HOME.lng)).toBeLessThan(0.01);
      }
    }
  });

  it("indexes EVERY segment of a bent barrier, not only the first", () => {
    // MUTATION TESTING FOUND THIS GAP. Every other fixture here is one
    // straight segment, so indexing only the first ring changed nothing and
    // the suite stayed green — while an L-shaped wall would have blocked along
    // one leg and let agents walk through the other.
    const corner = { lat: HOME.lat, lng: HOME.lng + STEP * 40 };
    const bent: OsmFeature = {
      type: "way",
      id: 5,
      geometry: [
        { lat: HOME.lat, lng: HOME.lng },
        corner,
        { lat: corner.lat + STEP * 40, lng: corner.lng },
      ],
      tags: { barrier: "wall" },
    };

    const index = buildObstacleIndex([bent]);
    const alongFirstLeg = cellAt(HOME.lat, HOME.lng);
    const alongSecondLeg = cellAt(corner.lat + STEP * 35, corner.lng);

    // The fixture is only meaningful if the two legs land in different cells.
    expect(alongSecondLeg).not.toBe(alongFirstLeg);
    expect(index.obstaclesIn(alongFirstLeg).length).toBe(1);
    expect(index.obstaclesIn(alongSecondLeg).length).toBe(1);
  });

  it("lists a multi-segment barrier once per cell, not once per segment", () => {
    // The segments of one wall are one obstacle. Listing it twice where two
    // quads overlap would double-count it in any consumer that measures rather
    // than merely tests.
    const bent: OsmFeature = {
      type: "way",
      id: 6,
      geometry: [
        { lat: HOME.lat, lng: HOME.lng },
        { lat: HOME.lat, lng: HOME.lng + STEP },
        { lat: HOME.lat, lng: HOME.lng + STEP * 2 },
      ],
      tags: { barrier: "wall" },
    };

    const index = buildObstacleIndex([bent]);
    expect(index.obstaclesIn(cellAt(HOME.lat, HOME.lng)).length).toBe(1);
  });

  it("indexes EVERY part of a multipolygon barrier, not just the first", () => {
    // RAISED IN REVIEW ON #260. The multipolygon branch took `polygons[0][0]`,
    // where the inner index correctly ignores holes but the OUTER one silently
    // discarded `polygons[1..]` — which are disjoint PARTS of the same barrier,
    // not holes. One part indexed, the other invisible: exactly the "a barrier
    // the index simply did not see" failure the branch was added to remove,
    // moved one level in.
    //
    // Two stitched outer rings, far enough apart to land in different cells.
    const far = { lat: HOME.lat + 0.004, lng: HOME.lng };
    const ring = (at: { lat: number; lng: number }) => [
      { lat: at.lat, lng: at.lng },
      { lat: at.lat, lng: at.lng + STEP * 20 },
      { lat: at.lat + STEP * 20, lng: at.lng + STEP * 20 },
      { lat: at.lat, lng: at.lng },
    ];

    const relation: OsmFeature = {
      type: "relation",
      id: 7,
      members: [
        { type: "way", ref: 71, role: "outer", geometry: ring(HOME) },
        { type: "way", ref: 72, role: "outer", geometry: ring(far) },
      ],
      tags: { type: "multipolygon", barrier: "wall" },
    };

    const index = buildObstacleIndex([relation]);
    const firstPart = cellAt(HOME.lat, HOME.lng);
    const secondPart = cellAt(far.lat, far.lng);

    // The fixture is only meaningful if the parts are genuinely disjoint.
    expect(secondPart).not.toBe(firstPart);
    expect(index.obstaclesIn(firstPart).length).toBe(1);
    expect(index.obstaclesIn(secondPart).length).toBe(1);
  });

  it("indexes a ONE-part multipolygon relation, which is the commoner shape", () => {
    // RAISED IN REVIEW ON #263, and it is the gap the test above left behind.
    // `relationToGeometry` only returns `kind: "multipolygon"` for TWO OR MORE
    // disjoint outers; a relation whose outers stitch into a single ring comes
    // back as `kind: "polygon"` (`osm-geometry.ts`). So an ordinary
    // `type=multipolygon` + `barrier=wall` relation — the common case — lands on
    // the `polygon` branch, which #263 also rewrote and which nothing reached.
    //
    // Nor does anything else reach it: osmtogeojson blacklists `barrier=wall`
    // in `POLYGON_FEATURES`, so even a CLOSED `barrier=wall` way is classified
    // as a linestring by `isAreaWay`. This relation is the only route in.
    const relation: OsmFeature = {
      type: "relation",
      id: 8,
      members: [
        {
          type: "way",
          ref: 81,
          role: "outer",
          geometry: [
            { lat: HOME.lat, lng: HOME.lng },
            { lat: HOME.lat, lng: HOME.lng + STEP * 20 },
            { lat: HOME.lat + STEP * 20, lng: HOME.lng + STEP * 20 },
            { lat: HOME.lat, lng: HOME.lng },
          ],
        },
      ],
      tags: { type: "multipolygon", barrier: "wall" },
    };

    const index = buildObstacleIndex([relation]);

    // Indexed at all — the assertion that fails if the branch ever starts
    // returning an empty line list rather than the outer ring.
    expect(index.obstaclesIn(cellAt(HOME.lat, HOME.lng)).length).toBe(1);
    // And along the ring rather than only at its first vertex, which is what
    // distinguishes "the outer ring was read" from "something was read".
    expect(
      index.obstaclesIn(cellAt(HOME.lat, HOME.lng + STEP * 20)).length,
    ).toBe(1);
  });

  it("survives a feature with unusable geometry", () => {
    // A one-node way and an empty way are both real Overpass output. Neither
    // has a footprint, and neither may take the index down.
    const index = buildObstacleIndex([
      { type: "way", id: 3, geometry: [], tags: { barrier: "wall" } },
      {
        type: "way",
        id: 4,
        geometry: [{ lat: HOME.lat, lng: HOME.lng }],
        tags: { barrier: "wall" },
      },
      wall(),
    ]);
    expect(index.obstaclesIn(cellAt(HOME.lat, HOME.lng)).length).toBe(1);
  });
});

describe("obstacleLevelsAt", () => {
  const groundAt = () => 0;

  it("offers the ground where nothing stands", () => {
    const index = buildObstacleIndex([wall()]);
    const levels = obstacleLevelsAt(
      index,
      cellAt(HOME.lat + 0.01, HOME.lng),
      groundAt,
    );
    expect(levels).toEqual([0]);
  });

  it("offers the wall top as well as the ground in a walled cell", () => {
    // BOTH, NOT EITHER. The cell contains the wall AND the ground beside it —
    // a res-13 cell is ~8 m across and a wall is under a metre thick, so a
    // model that removed the ground level would make it impossible to walk
    // beside a wall at all.
    const index = buildObstacleIndex([wall()]);
    const levels = obstacleLevelsAt(
      index,
      cellAt(HOME.lat, HOME.lng),
      groundAt,
    );

    expect(levels).toContain(0);
    expect(levels).toContain(DEFAULT_BARRIER_HEIGHT_M);
  });

  it("offers each distinct obstacle height once", () => {
    // Two walls of the same height crossing one cell is one standable level,
    // not two identical ones — duplicates would inflate the search's state
    // count for nothing.
    const index = buildObstacleIndex([
      wall({ height: "3" }),
      { ...wall({ height: "3" }), id: 9 },
    ]);
    const levels = obstacleLevelsAt(
      index,
      cellAt(HOME.lat, HOME.lng),
      groundAt,
    );

    expect(levels.filter((level) => level === 3)).toHaveLength(1);
  });

  it("returns levels in ascending order", () => {
    // Determinism, for the same reason every other list here is sorted: a
    // route that varied with the order features arrived from Overpass would be
    // unreproducible.
    const index = buildObstacleIndex([
      wall({ height: "6" }),
      { ...wall({ height: "2" }), id: 8 },
    ]);
    const levels = obstacleLevelsAt(
      index,
      cellAt(HOME.lat, HOME.lng),
      groundAt,
    );

    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  it("adds the obstacle height to the ground beneath it", () => {
    // A 2 m wall on a 30 m hill is standable at 32 m, not at 2 m. Heights are
    // relative to the terrain, and treating them as absolute would put every
    // wall top underground on any real slope.
    const index = buildObstacleIndex([wall()]);
    const levels = obstacleLevelsAt(
      index,
      cellAt(HOME.lat, HOME.lng),
      () => 30,
    );

    expect(levels).toContain(30);
    expect(levels).toContain(30 + DEFAULT_BARRIER_HEIGHT_M);
  });

  it("returns nothing where the ground height is unknown", () => {
    // A NaN from a missed DEM lookup must not become a state. `columnsAdjacent`
    // would refuse every step involving it, which is an invisible wall — but a
    // cell with NO levels is at least visibly unreachable.
    const index = buildObstacleIndex([wall()]);
    expect(
      obstacleLevelsAt(index, cellAt(HOME.lat, HOME.lng), () => NaN),
    ).toEqual([]);
  });
});

describe("crossesObstacle — what finally makes a wall block", () => {
  /**
   * WHY THIS BLOCK MATTERS MOST OF ALL. Everything above it indexes and
   * reports; none of it stops anything. The header of this file said so
   * explicitly — "an agent gets the wall top as an extra state and the ground
   * beneath the wall stays fully traversable" — and this is the slice it named
   * as the fix.
   *
   * The reason it has to be a step predicate rather than a standability rule is
   * arithmetic: a res-13 cell is ~8 m across and a wall is ~0.5 m thick, so a
   * wall contains a cell's centre about one time in sixteen. Anything keyed on
   * "is this cell walled" is transparent to pathfinding the other fifteen.
   */

  /** Two cells either side of a long north-south wall at HOME's longitude. */
  const northSouthWall: OsmFeature = {
    type: "way",
    id: 20,
    geometry: [
      { lat: HOME.lat - STEP * 200, lng: HOME.lng },
      { lat: HOME.lat + STEP * 200, lng: HOME.lng },
    ],
    tags: { barrier: "wall" },
  };

  /**
   * A NEIGHBOURING pair straddling the wall, found rather than guessed.
   *
   * The predicate is defined for adjacent cells — every candidate the search
   * generates comes from `gridDisk(cell, 1)` — and hand-picked coordinates at
   * res-13 land two cells apart as easily as one. Deriving the pair from
   * `gridDisk` keeps the fixture honest about what is actually being asked.
   */
  function straddlingPair(lngOfWall: number): [string, string] {
    const west = cellAt(HOME.lat, lngOfWall - STEP * 6);
    for (const neighbour of gridDisk(west, 1)) {
      if (neighbour === west) continue;
      const [, lng] = cellToLatLng(neighbour);
      if (lng > lngOfWall) return [west, neighbour];
    }
    throw new Error("no neighbouring cell east of the wall");
  }

  it("blocks a step that crosses a wall", () => {
    const index = buildObstacleIndex([northSouthWall]);
    const [west, east] = straddlingPair(HOME.lng);

    const [, westLng] = cellToLatLng(west);
    const [, eastLng] = cellToLatLng(east);
    // The fixture is only meaningful if the two centres really are either side.
    expect(westLng).toBeLessThan(HOME.lng);
    expect(eastLng).toBeGreaterThan(HOME.lng);
    expect(crossesObstacle(index, west, east)).toBe(true);
  });

  it("admits a step that runs ALONGSIDE the wall", () => {
    // The mirror direction, and the one that decides whether this is usable: a
    // predicate that blocked everything near a wall would fence off both
    // pavements and read as broken pathfinding rather than as a wall.
    const index = buildObstacleIndex([northSouthWall]);
    const south = cellAt(HOME.lat - STEP * 12, HOME.lng - STEP * 20);
    const north = cellAt(HOME.lat + STEP * 12, HOME.lng - STEP * 20);

    expect(south).not.toBe(north);
    expect(crossesObstacle(index, south, north)).toBe(false);
  });

  it("never blocks a step from a cell to itself", () => {
    // Standing still, and — more to the point — stepping between two LEVELS of
    // one cell, which is the only move the column model has that a 2D model
    // does not. Asking the predicate about a cell and itself would refuse it
    // wherever the wall's own footprint covers that cell.
    const index = buildObstacleIndex([northSouthWall]);
    const on = cellAt(HOME.lat, HOME.lng);

    expect(crossesObstacle(index, on, on)).toBe(false);
  });

  it("admits every step when there is nothing in the index", () => {
    // Rung 5.3 of the design: with no obstacles, agents wander freely. A
    // predicate that failed closed would make an empty index impassable.
    const index = buildObstacleIndex([]);
    expect(
      crossesObstacle(
        index,
        cellAt(HOME.lat, HOME.lng),
        cellAt(HOME.lat, HOME.lng + STEP * 12),
      ),
    ).toBe(false);
  });

  it("blocks a step into a building", () => {
    // Buildings are obstacles too, under the same rule the extruder draws.
    const building: OsmFeature = {
      type: "way",
      id: 21,
      geometry: [
        { lat: HOME.lat - STEP * 20, lng: HOME.lng - STEP * 20 },
        { lat: HOME.lat - STEP * 20, lng: HOME.lng + STEP * 20 },
        { lat: HOME.lat + STEP * 20, lng: HOME.lng + STEP * 20 },
        { lat: HOME.lat + STEP * 20, lng: HOME.lng - STEP * 20 },
        { lat: HOME.lat - STEP * 20, lng: HOME.lng - STEP * 20 },
      ],
      tags: { building: "yes" },
    };

    const index = buildObstacleIndex([building]);
    const outside = cellAt(HOME.lat, HOME.lng - STEP * 40);
    const inside = cellAt(HOME.lat, HOME.lng);

    expect(outside).not.toBe(inside);
    expect(crossesObstacle(index, outside, inside)).toBe(true);
  });

  it("leaves a gateway passable — min_height means you walk under it", () => {
    // `min_height` is the S3DB form for an arch or a canopy. Obstructing the
    // ground under one seals the route through it, and walking under a gate is
    // the exact move the demo needs at a walled site.
    const gateway: OsmFeature = {
      type: "way",
      id: 22,
      geometry: [
        { lat: HOME.lat - STEP * 20, lng: HOME.lng - STEP * 20 },
        { lat: HOME.lat - STEP * 20, lng: HOME.lng + STEP * 20 },
        { lat: HOME.lat + STEP * 20, lng: HOME.lng + STEP * 20 },
        { lat: HOME.lat + STEP * 20, lng: HOME.lng - STEP * 20 },
        { lat: HOME.lat - STEP * 20, lng: HOME.lng - STEP * 20 },
      ],
      tags: { "building:part": "yes", min_height: "4", height: "9" },
    };

    const index = buildObstacleIndex([gateway]);
    expect(
      crossesObstacle(
        index,
        cellAt(HOME.lat, HOME.lng - STEP * 40),
        cellAt(HOME.lat, HOME.lng),
      ),
    ).toBe(false);
  });

  it("does not index an outline that has parts — the parts replace it", () => {
    // The same rule the extruder uses, so what blocks and what is drawn are the
    // same volumes. Without it a courtyard between two wings would be sealed by
    // the outline that encloses both.
    const outline: OsmFeature = {
      type: "way",
      id: 23,
      geometry: [
        { lat: HOME.lat - STEP * 40, lng: HOME.lng - STEP * 40 },
        { lat: HOME.lat - STEP * 40, lng: HOME.lng + STEP * 40 },
        { lat: HOME.lat + STEP * 40, lng: HOME.lng + STEP * 40 },
        { lat: HOME.lat + STEP * 40, lng: HOME.lng - STEP * 40 },
        { lat: HOME.lat - STEP * 40, lng: HOME.lng - STEP * 40 },
      ],
      tags: { building: "yes" },
    };
    const part: OsmFeature = {
      type: "way",
      id: 24,
      geometry: [
        { lat: HOME.lat - STEP * 35, lng: HOME.lng - STEP * 35 },
        { lat: HOME.lat - STEP * 35, lng: HOME.lng - STEP * 25 },
        { lat: HOME.lat - STEP * 25, lng: HOME.lng - STEP * 25 },
        { lat: HOME.lat - STEP * 25, lng: HOME.lng - STEP * 35 },
        { lat: HOME.lat - STEP * 35, lng: HOME.lng - STEP * 35 },
      ],
      tags: { "building:part": "yes", height: "10" },
    };

    const index = buildObstacleIndex([outline, part]);
    const indexed = new Set<string>();
    for (const cell of index.cells) {
      for (const obstacle of index.obstaclesIn(cell))
        indexed.add(obstacle.feature);
    }

    expect(indexed.has("way/24")).toBe(true);
    expect(indexed.has("way/23")).toBe(false);
  });
});

describe("a road tagged as a building passage opens the building it pierces (DEC-R12-3)", () => {
  // WHY THIS BLOCK MATTERS. The session asked for an archway where a way crosses
  // a building. The one rule that existed — S3DB `min_height > 0` — does not
  // fire for the reported case, a road through a gate tower with no height
  // tagging, and `tunnel=building_passage` is what mappers write instead.
  //
  // The scope is what these assertions are really about. Treating the WHOLE
  // volume as passable, which is how the other two passable-underneath rules
  // work, was measured over the corpus at 30-35 % of the built AREA becoming
  // walk-through at Cologne, Tokyo and Tower Bridge. So the passage opens a
  // corridor and the rest of the same building stays exactly as solid as it was
  // — which is the pair of tests below, and neither is meaningful alone.

  /** A 40 x 40 m building centred on HOME. */
  const block: OsmFeature = {
    type: "way",
    id: 30,
    geometry: [
      { lat: HOME.lat - STEP * 22, lng: HOME.lng - STEP * 22 },
      { lat: HOME.lat - STEP * 22, lng: HOME.lng + STEP * 22 },
      { lat: HOME.lat + STEP * 22, lng: HOME.lng + STEP * 22 },
      { lat: HOME.lat + STEP * 22, lng: HOME.lng - STEP * 22 },
      { lat: HOME.lat - STEP * 22, lng: HOME.lng - STEP * 22 },
    ],
    tags: { building: "yes", height: "12" },
  };

  /** A footway west→east through the middle of it, at HOME's latitude. */
  const passage = (tags: Record<string, string>): OsmFeature => ({
    type: "way",
    id: 31,
    geometry: [
      { lat: HOME.lat, lng: HOME.lng - STEP * 40 },
      { lat: HOME.lat, lng: HOME.lng + STEP * 40 },
    ],
    tags: { highway: "footway", ...tags },
  });

  /** A neighbouring pair straddling the building's WEST wall at latitude `lat`. */
  function pairAcrossWestWall(lat: number): [string, string] {
    const wallLng = HOME.lng - STEP * 22;
    const outside = cellAt(lat, wallLng - STEP * 6);
    for (const neighbour of gridDisk(outside, 1)) {
      if (neighbour === outside) continue;
      const [, lng] = cellToLatLng(neighbour);
      if (lng > wallLng) return [outside, neighbour];
    }
    throw new Error("no neighbouring cell inside the building");
  }

  it("admits a step through the passage", () => {
    const index = buildObstacleIndex([
      block,
      passage({ tunnel: "building_passage" }),
    ]);
    const [outside, inside] = pairAcrossWestWall(HOME.lat);
    expect(crossesObstacle(index, outside, inside)).toBe(false);
  });

  it("still blocks a step through the SAME building away from the passage", () => {
    // The counterweight. Without it, "open the whole volume" would pass the test
    // above — and that is the reading the corpus measurement ruled out.
    const index = buildObstacleIndex([
      block,
      passage({ tunnel: "building_passage" }),
    ]);
    const [outside, inside] = pairAcrossWestWall(HOME.lat + STEP * 15);
    expect(crossesObstacle(index, outside, inside)).toBe(true);
  });

  it("blocks the same step when the road is NOT tagged as a passage", () => {
    // The before picture: a road crossing a building outline in plan is normally
    // running above or below it, so the tag is doing all the work.
    const index = buildObstacleIndex([block, passage({})]);
    const [outside, inside] = pairAcrossWestWall(HOME.lat);
    expect(crossesObstacle(index, outside, inside)).toBe(true);
  });

  it("leaves the building DRAWN and indexed — it is opened, not deleted", () => {
    // The same shape `min_height` volumes have: passability is an index-only
    // property, and the volume is still there to be seen and still blocks
    // everywhere the passage does not run. A building that vanished from the
    // index entirely would be the whole-volume reading by another route.
    const index = buildObstacleIndex([
      block,
      passage({ tunnel: "building_passage" }),
    ]);
    const indexed = new Set<string>();
    for (const cell of index.cells) {
      for (const obstacle of index.obstaclesIn(cell))
        indexed.add(obstacle.feature);
    }
    expect(indexed.has("way/30")).toBe(true);
  });
});
