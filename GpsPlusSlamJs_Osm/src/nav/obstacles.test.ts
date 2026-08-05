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
 * **NOTHING HERE BLOCKS ANYTHING YET.** `Obstacle.rings` is built and stored,
 * but no code in this slice asks `containsPoint` about it: `obstacleLevelsAt`
 * only ADDS a level. Wired into `columnSpace` as it stands, an agent gets the
 * wall top as an extra state and the ground beneath the wall stays fully
 * traversable. An earlier draft of this comment claimed the footprint was
 * blocked, which review on #259 correctly called out as describing behaviour
 * that does not exist. The footprint test is the next slice.
 *
 * @see obstacles.ts.md
 */

import { describe, expect, it } from "vitest";
import { latLngToCell } from "h3-js";

import { buildObstacleIndex, obstacleLevelsAt } from "./obstacles.js";
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
