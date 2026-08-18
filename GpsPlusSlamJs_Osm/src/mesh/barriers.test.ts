/**
 * Barrier tag reading.
 *
 * Why these tests matter:
 * The navigation design's motivating complaint is an agent walking up the
 * Tower's curtain wall, and DEC-R7b-14 records that the obstacle set is wider
 * than `BuildingVolume` — barriers count, and they must be DRAWN, because an
 * NPC dodging geometry the viewer cannot see demonstrates nothing.
 *
 * The numbers here are the owner's (DEC-R11-2), not inferred: an untagged
 * `barrier=wall` is 2 m, `barrier=hedge` is solid, and thickness comes from
 * `width` falling back to a constant. The alternative the owner rejected was
 * obstructing only where OSM tags an explicit height — honest, but most walls
 * are untagged, so the curtain wall would have stayed passable and the demo
 * would have shown nothing at the one place the session complained about.
 *
 * The failure mode these guard is silence in both directions: too narrow a
 * solid set leaves the wall walkable, and too wide a one turns every gate and
 * kerb into an impassable obstacle, which looks like broken pathfinding rather
 * than like a tagging decision.
 *
 * @see barriers.ts.md
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_BARRIER_HEIGHT_M,
  DEFAULT_BARRIER_THICKNESS_M,
  DEFAULT_CITY_WALL_HEIGHT_M,
  isSolidBarrier,
  resolveBarrier,
} from "./barriers.js";
import type { OsmFeature, OsmTags } from "../model/osm-feature.js";

const way = (tags: Record<string, string>): OsmFeature => ({
  type: "way",
  id: 1,
  geometry: [
    { lat: 50.9413, lng: 6.9583 },
    { lat: 50.9414, lng: 6.9584 },
  ],
  tags,
});

describe("isSolidBarrier", () => {
  it("accepts the barriers a person cannot walk through", () => {
    // WALL AND HEDGE ARE THE OWNER'S CALL (DEC-R11-2). Fence and the wall
    // variants follow from the same question — you cannot walk through any of
    // them — and they are listed explicitly rather than matched by a pattern,
    // so adding one is a decision someone makes on purpose.
    for (const value of [
      "wall",
      "city_wall",
      "retaining_wall",
      "fence",
      "hedge",
    ]) {
      expect(isSolidBarrier(way({ barrier: value })), value).toBe(true);
    }
  });

  it("rejects the barriers that are openings", () => {
    // A GATE IS A HOLE IN A WALL, not a wall. Treating it as solid would seal
    // the one route the design's own test case depends on — the path that
    // reaches the gate rather than going over the wall.
    for (const value of ["gate", "lift_gate", "entrance", "cycle_barrier"]) {
      expect(isSolidBarrier(way({ barrier: value })), value).toBe(false);
    }
  });

  it("rejects barriers below the step threshold", () => {
    // A kerb is ~0.15 m and a bollard is something you walk around in a metre.
    // Both are inside `STEP_THRESHOLD_M`, so making them obstacles would
    // contradict the column model rather than complement it.
    for (const value of ["kerb", "bollard", "block"]) {
      expect(isSolidBarrier(way({ barrier: value })), value).toBe(false);
    }
  });

  it("rejects a feature with no barrier tag", () => {
    expect(isSolidBarrier(way({ highway: "footway" }))).toBe(false);
    expect(isSolidBarrier(way({}))).toBe(false);
  });

  it("rejects an unknown barrier value rather than guessing", () => {
    // FAILS TOWARDS PASSABLE. An unknown value could be anything, and an
    // invented obstacle is the worse error: it produces a detour with no
    // visible cause, which reads as a pathfinding bug. A missed obstacle at
    // least looks like the thing it is.
    expect(isSolidBarrier(way({ barrier: "yes" }))).toBe(false);
    expect(isSolidBarrier(way({ barrier: "spinning_top_of_the_line" }))).toBe(
      false,
    );
  });

  it("ignores a barrier tag on a node", () => {
    // A node barrier has no extent to obstruct — `barrier=gate` on a node is
    // the common tagging, and a zero-length wall is not a wall.
    expect(
      isSolidBarrier({
        type: "node",
        id: 2,
        position: { lat: 50.9413, lng: 6.9583 },
        tags: { barrier: "wall" },
      }),
    ).toBe(false);
  });

  it("accepts historic=citywalls, which carries no barrier tag at all", () => {
    // MEASURED, NOT ASSUMED. The design named `historic=citywalls` in pass B's
    // obstacle set and the first implementation keyed solely on `barrier=*`,
    // which drops it. All four `historic=citywalls` ways in the Cologne fixture
    // carry NO `barrier` tag, so every one of them was invisible — and a city
    // wall is the design's motivating example. See `site-barriers.test.ts`,
    // which asserts the same thing on the real extract.
    expect(isSolidBarrier(way({ historic: "citywalls" }))).toBe(true);
  });

  it("still ignores other historic values", () => {
    // The narrow reading, so this does not become "anything old is solid". A
    // `historic=castle` outline is a building question, not a barrier one — and
    // treating it as a wall would trace a band around the whole bailey.
    expect(isSolidBarrier(way({ historic: "castle" }))).toBe(false);
    expect(isSolidBarrier(way({ historic: "monument" }))).toBe(false);
  });
});

describe("resolveBarrier", () => {
  it("uses the owner's default height for an untagged wall", () => {
    // DEC-R11-2, stated as a number so a later edit has to argue with a test.
    expect(resolveBarrier({ barrier: "wall" }).heightM).toBe(
      DEFAULT_BARRIER_HEIGHT_M,
    );
    expect(DEFAULT_BARRIER_HEIGHT_M).toBe(2);
  });

  it("prefers an explicit height tag over the default", () => {
    expect(resolveBarrier({ barrier: "wall", height: "8" }).heightM).toBe(8);
  });

  it("reads a height with units", () => {
    // `parseLengthMetres` already handles the unit forms OSM uses; this pins
    // that barriers go through it rather than growing a second parser.
    expect(resolveBarrier({ barrier: "wall", height: "3 m" }).heightM).toBe(3);
  });

  it("falls back to the default for an unparseable height", () => {
    // `height=tall` is real tagging. A NaN height would propagate into the
    // column model, where a non-finite value makes every step non-adjacent —
    // an invisible wall around the whole feature.
    expect(resolveBarrier({ barrier: "wall", height: "tall" }).heightM).toBe(
      DEFAULT_BARRIER_HEIGHT_M,
    );
    expect(resolveBarrier({ barrier: "wall", height: "" }).heightM).toBe(
      DEFAULT_BARRIER_HEIGHT_M,
    );
  });

  it("ignores a non-positive height", () => {
    // A 0 m wall obstructs nothing and would be drawn as a degenerate quad.
    expect(resolveBarrier({ barrier: "wall", height: "0" }).heightM).toBe(
      DEFAULT_BARRIER_HEIGHT_M,
    );
    expect(resolveBarrier({ barrier: "wall", height: "-3" }).heightM).toBe(
      DEFAULT_BARRIER_HEIGHT_M,
    );
  });

  it("gives a city wall its own taller default", () => {
    // NOT 2 m. The design's motivating example is an 8 m curtain wall, and a
    // 2 m city wall is wrong in the one case this feature exists for. Tagged
    // heights still win.
    expect(resolveBarrier({ barrier: "city_wall" }).heightM).toBeGreaterThan(
      DEFAULT_BARRIER_HEIGHT_M,
    );
    expect(resolveBarrier({ barrier: "city_wall", height: "8" }).heightM).toBe(
      8,
    );
  });

  it("gives historic=citywalls the city-wall height, not the general one", () => {
    // Same reasoning as `barrier=city_wall` (DEC-R11-4): it IS a city wall, and
    // the tag it happens to be recorded under does not change how tall it is.
    // Reading it as a generic 2 m barrier would leave Cologne's walls looking
    // climbable in exactly the case the design set out to fix.
    expect(resolveBarrier({ historic: "citywalls" }).heightM).toBe(
      DEFAULT_CITY_WALL_HEIGHT_M,
    );
    expect(resolveBarrier({ historic: "citywalls", height: "9" }).heightM).toBe(
      9,
    );
  });

  it("takes thickness from width, falling back to the constant", () => {
    expect(resolveBarrier({ barrier: "wall" }).thicknessM).toBe(
      DEFAULT_BARRIER_THICKNESS_M,
    );
    expect(resolveBarrier({ barrier: "wall", width: "1.2" }).thicknessM).toBe(
      1.2,
    );
    expect(resolveBarrier({ barrier: "wall", width: "junk" }).thicknessM).toBe(
      DEFAULT_BARRIER_THICKNESS_M,
    );
  });

  it("always returns finite, positive numbers", () => {
    // THE INVARIANT THE COLUMN MODEL DEPENDS ON. A non-finite height reaching
    // `columnsAdjacent` makes every step involving it non-adjacent, sealing
    // the feature off invisibly.
    const cases: OsmTags[] = [
      { barrier: "wall" },
      { barrier: "hedge", height: "NaN" },
      { barrier: "fence", height: "Infinity", width: "-1" },
      { barrier: "wall", height: "1e400" },
    ];
    for (const tags of cases) {
      const resolved = resolveBarrier(tags);
      expect(Number.isFinite(resolved.heightM), JSON.stringify(tags)).toBe(
        true,
      );
      expect(resolved.heightM).toBeGreaterThan(0);
      expect(Number.isFinite(resolved.thicknessM)).toBe(true);
      expect(resolved.thicknessM).toBeGreaterThan(0);
    }
  });
});
