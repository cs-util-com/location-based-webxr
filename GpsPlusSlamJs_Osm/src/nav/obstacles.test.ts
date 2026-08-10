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

  it("keeps answering correctly once the centre memo is warm", () => {
    // WHY THIS TEST MATTERS. `crossesObstacle` memoises cell centres, because
    // the two `cellToLatLng` calls were ~38 % of its per-step cost (measured in
    // `obstacles.bench.ts`, which prices a step with NO obstacles anywhere in
    // its disk at the same 6.2 µs as one with them — so the bill was the fixed
    // work, not the geometry).
    //
    // A memo can only fail in ways that are invisible to a cold single
    // assertion: a mutated shared point, or a key that collides. So this asks
    // the SAME question after the cache has been filled by many other cells,
    // which is the shape a real search has and a fresh fixture does not.
    const index = buildObstacleIndex([northSouthWall]);
    const [west, east] = straddlingPair(HOME.lng);

    const cold = crossesObstacle(index, west, east);
    expect(cold).toBe(true);

    // Warm the cache with a few hundred unrelated cells, as an A* expansion
    // would, then ask again. Both the blocked and the free answer must survive.
    const south = cellAt(HOME.lat - STEP * 12, HOME.lng - STEP * 20);
    const north = cellAt(HOME.lat + STEP * 12, HOME.lng - STEP * 20);
    for (let i = 1; i <= 300; i++) {
      const a = cellAt(HOME.lat + STEP * i, HOME.lng - STEP * (i + 30));
      const b = cellAt(HOME.lat + STEP * (i + 1), HOME.lng - STEP * (i + 30));
      crossesObstacle(index, a, b);
    }

    expect(crossesObstacle(index, west, east)).toBe(true);
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

  it("admits a step inside a COURTYARD of a pierced building", () => {
    // WHY THIS TEST MATTERS, and it is a GUARD rather than a bug reproduction.
    //
    // A review argued that `blockedDespitePassages` has a live defect here: it
    // decides "is this step inside the obstacle" with
    // `rings.some(ring => contains(a) && contains(b))` — inside ANY ring —
    // where `building-passages.ts`'s `insideFootprint` uses ring PARITY and
    // documents why (*"it moved Tokyo's count from 6 to 7 buildings"*). Under
    // `some`, a step in a courtyard is "inside the outer ring", so a pierced
    // building would refuse it and the courtyard would be unwalkable.
    //
    // **THAT DOES NOT REPRODUCE, and this test is what establishes it.** The
    // structural assertions below prove the fixture really does exercise the
    // path — a multi-ring obstacle carrying passages — and the step is still
    // admitted. So the `some`/parity divergence is real in the source and does
    // NOT change behaviour in this configuration. Not fixed, because the repo's
    // rule is to confirm a behaviour is wrong before changing it, and this one
    // is not confirmed.
    //
    // Kept because the water veto is where the argument would bite hardest —
    // the inner rings of the Thames relations are islands and piers — so if that
    // work makes this fail, the failure is the reproduction the fix needs.
    const courtyardBlock: OsmFeature = {
      type: "relation",
      id: 40,
      members: [
        { type: "way", ref: 41, role: "outer", geometry: block.geometry },
        {
          type: "way",
          ref: 42,
          role: "inner",
          geometry: [
            { lat: HOME.lat - STEP * 10, lng: HOME.lng - STEP * 10 },
            { lat: HOME.lat - STEP * 10, lng: HOME.lng + STEP * 10 },
            { lat: HOME.lat + STEP * 10, lng: HOME.lng + STEP * 10 },
            { lat: HOME.lat + STEP * 10, lng: HOME.lng - STEP * 10 },
            { lat: HOME.lat - STEP * 10, lng: HOME.lng - STEP * 10 },
          ],
        },
      ],
      tags: { building: "yes", height: "12", type: "multipolygon" },
    };

    const index = buildObstacleIndex([
      courtyardBlock,
      passage({ tunnel: "building_passage" }),
    ]);

    // Two neighbouring cells both well inside the courtyard, north of the
    // passage so neither runs along it — the case that must still be free.
    const inCourtyard = cellAt(HOME.lat + STEP * 5, HOME.lng - STEP * 3);
    const alsoInCourtyard = gridDisk(inCourtyard, 1).find((cell) => {
      if (cell === inCourtyard) return false;
      const [lat, lng] = cellToLatLng(cell);
      return (
        lat > HOME.lat + STEP * 2 &&
        lat < HOME.lat + STEP * 9 &&
        lng > HOME.lng - STEP * 9 &&
        lng < HOME.lng + STEP * 9
      );
    });
    expect(alsoInCourtyard).toBeDefined();

    // THE FIXTURE MUST ACTUALLY EXERCISE THE PATH, or this test passes for the
    // wrong reason: it needs an obstacle with a HOLE and with PASSAGES, since
    // the suspect branch only runs when both are true.
    const here = index.obstaclesIn(inCourtyard);
    expect(here.length).toBeGreaterThan(0);
    expect(here[0]!.rings.length).toBeGreaterThan(1);
    expect(here[0]!.passages).toBeDefined();

    expect(crossesObstacle(index, inCourtyard, alsoInCourtyard as string)).toBe(
      false,
    );
  });

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

  it("does NOT free the interior — a step between two rooms away from the passage still blocks", () => {
    // THE DEFECT THIS RULE ALMOST SHIPPED WITH, found in review. Blocking was a
    // pure BOUNDARY property: `segmentCrossesRing` is false for a segment lying
    // wholly inside a ring, and `obstacleLevelsAt` never removes the ground
    // level from a cell inside a footprint. That combination was harmless only
    // because a closed footprint was UNREACHABLE — you could never get in, so
    // interior freedom was unobservable. An opening makes it reachable, and
    // every subsequent interior step crosses no ring at all.
    //
    // The consequence is exactly the picture the 22 %/34 % measurement was used
    // to rule out, scoped smaller: a route cutting a diagonal between two mouths
    // through the rooms between them, and `planRoute` happily routing an agent
    // to a destination inside the building. So "a corridor, not the whole
    // volume" has to be true of the INTERIOR as well as of the boundary.
    const index = buildObstacleIndex([
      block,
      passage({ tunnel: "building_passage" }),
    ]);

    // Two neighbouring cells well north of the passage line, both inside.
    const north = HOME.lat + STEP * 15;
    const inside = cellAt(north, HOME.lng - STEP * 8);
    const neighbour = gridDisk(inside, 1).find((cell) => {
      if (cell === inside) return false;
      const [lat, lng] = cellToLatLng(cell);
      return lng > HOME.lng - STEP * 8 && lat > HOME.lat + STEP * 8;
    });
    if (neighbour === undefined) throw new Error("no interior neighbour found");

    expect(crossesObstacle(index, inside, neighbour)).toBe(true);
  });

  it("keeps the corridor itself walkable end to end", () => {
    // The counterweight to the test above, and the reason it cannot be satisfied
    // by simply blocking everything inside: the passage has to remain a route
    // THROUGH, not a pocket you can enter and not leave.
    const index = buildObstacleIndex([
      block,
      passage({ tunnel: "building_passage" }),
    ]);
    const west = cellAt(HOME.lat, HOME.lng - STEP * 8);
    const east = gridDisk(west, 1).find((cell) => {
      if (cell === west) return false;
      const [, lng] = cellToLatLng(cell);
      return lng > HOME.lng - STEP * 8;
    });
    if (east === undefined) throw new Error("no neighbour along the passage");

    expect(crossesObstacle(index, west, east)).toBe(false);
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

describe("water blocks the bank, not the whole river (DEC-A4)", () => {
  /**
   * WHY THIS BLOCK MATTERS. The reported case is an NPC walking across the
   * Thames: `route-penalty.ts` caps bad ground at three times its metres and
   * says why — *"obstacles are `crossesObstacle`'s job alone in this demo"* — so
   * water was expensive and never impossible, and a destination in the river
   * could not be priced out at any multiplier.
   *
   * **INDEXED AS A BAND ALONG THE BANKS, NOT AS A FILLED AREA**, and that is a
   * measured choice rather than a stylistic one. Over the corpus, filled and
   * clipped costs 13 966–18 246 covered cells against a budget of **1 000–10 000
   * for a whole site's index**; the band, clipped, costs **1 153–1 517**. Only
   * band-plus-clip fits. See `site-water-index-cost.test.ts` for the table.
   *
   * It is also the right SEMANTICS, not merely the cheap one: `crossesObstacle`
   * is a crossing test, so a band along the banks refuses every step that enters
   * the water while leaving mid-river steps unindexed — and a destination in the
   * river simply becomes unreachable, which is what "you cannot walk there"
   * means for a search.
   */

  /** A ~90 m wide river running east–west, north of HOME. */
  const river: OsmFeature = {
    type: "way",
    id: 50,
    geometry: [
      { lat: HOME.lat + STEP * 20, lng: HOME.lng - STEP * 200 },
      { lat: HOME.lat + STEP * 20, lng: HOME.lng + STEP * 200 },
      { lat: HOME.lat + STEP * 120, lng: HOME.lng + STEP * 200 },
      { lat: HOME.lat + STEP * 120, lng: HOME.lng - STEP * 200 },
      { lat: HOME.lat + STEP * 20, lng: HOME.lng - STEP * 200 },
    ],
    tags: { natural: "water", water: "river" },
  };

  /** A neighbouring pair straddling the river's SOUTH bank. */
  function pairAcrossBank(): [string, string] {
    const bankLat = HOME.lat + STEP * 20;
    const outside = cellAt(bankLat - STEP * 6, HOME.lng);
    for (const neighbour of gridDisk(outside, 1)) {
      if (neighbour === outside) continue;
      const [lat] = cellToLatLng(neighbour);
      if (lat > bankLat) return [outside, neighbour];
    }
    throw new Error("no neighbouring cell across the bank");
  }

  it("blocks a step from the land into the water", () => {
    const index = buildObstacleIndex([river]);
    const [land, water] = pairAcrossBank();

    const [landLat] = cellToLatLng(land);
    const [waterLat] = cellToLatLng(water);
    // The fixture is only meaningful if the two centres really are either side.
    expect(landLat).toBeLessThan(HOME.lat + STEP * 20);
    expect(waterLat).toBeGreaterThan(HOME.lat + STEP * 20);

    expect(crossesObstacle(index, land, water)).toBe(true);
  });

  it("admits a step that runs along the bank, on dry land", () => {
    // The mirror direction, and the one that decides whether this is usable: a
    // veto that fenced off the towpath would read as broken pathfinding rather
    // than as a river.
    const index = buildObstacleIndex([river]);
    const west = cellAt(HOME.lat, HOME.lng - STEP * 6);
    const east = cellAt(HOME.lat, HOME.lng + STEP * 6);

    expect(west).not.toBe(east);
    expect(crossesObstacle(index, west, east)).toBe(false);
  });

  it("adds no standable level — water is a footprint with no volume", () => {
    // `heightM = 0`, so `obstacleLevelsAt` offers the ground and nothing else.
    // A river the agent could stand ON TOP of would be the whole point missed.
    const index = buildObstacleIndex([river]);
    const inRiver = cellAt(HOME.lat + STEP * 70, HOME.lng);
    const levels = obstacleLevelsAt(index, inRiver, () => 0);

    expect(levels).toEqual([0]);
  });

  it("ignores a river CENTRELINE, which has no banks to stand on", () => {
    // `waterway=river` on an open way is the river's centreline, not its area —
    // 3 such ways at london-tower-bridge, none of them closed. Banding it would
    // put a 1-cell ribbon down the middle of the river, which is neither its
    // area nor a bank anyone crosses.
    const centreline: OsmFeature = {
      type: "way",
      id: 51,
      geometry: [
        { lat: HOME.lat + STEP * 70, lng: HOME.lng - STEP * 200 },
        { lat: HOME.lat + STEP * 70, lng: HOME.lng + STEP * 200 },
      ],
      tags: { waterway: "river" },
    };
    const index = buildObstacleIndex([centreline]);
    expect(index.cells.size).toBe(0);
  });
});
