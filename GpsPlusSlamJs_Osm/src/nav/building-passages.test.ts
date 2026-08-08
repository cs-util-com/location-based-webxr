/**
 * `building-passages.ts` — a road that goes THROUGH a building.
 *
 * Why this test matters:
 * The eighth testing session asked for an archway where a way crosses a
 * building, and the code had one rule for it — S3DB `min_height > 0` — which
 * does not fire for the commonest case: a road through a gate tower with no
 * height tagging. `tunnel=building_passage` is the tag mappers actually use, and
 * DEC-R12-3 adopted it.
 *
 * The load-bearing assertion is the SCOPE. DEC-R12-3's wording offered two
 * readings — "the same passable-underneath treatment `min_height` gets" (the
 * whole volume stops obstructing) and "passable ALONG it" (a corridor). Measured
 * over the corpus, the first reading makes 30-35 % of the built AREA at Cologne,
 * Tokyo and Tower Bridge walk-through, and 22 % of the buildings at Tower Bridge
 * — an agent strolling through a city block because one arcade was mapped. That
 * is the same failure DEC-R12-1 refused for barriers, so the corridor reading is
 * the one implemented and the tests below pin it: the passage opens, and the
 * rest of the same building stays solid.
 *
 * @see building-passages.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-08-08-1330-osm-demo-eighth-testing-session-user-feedback.md §4 DEC-R12-3
 */

import { describe, expect, it } from "vitest";

import { passageOpenings } from "./building-passages.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";

/** A metre in degrees, close enough for a fixture. */
const M = 1 / 111_320;
const ORIGIN: LatLng = { lat: 51.5, lng: -0.1 };

function at(eastM: number, northM: number): LatLng {
  return {
    lat: ORIGIN.lat + northM * M,
    lng: ORIGIN.lng + (eastM * M) / Math.cos((ORIGIN.lat * Math.PI) / 180),
  };
}

/** Degrees the way the obstacle index holds them: `x = lng`, `y = lat`. */
const planar = (position: LatLng) => ({ x: position.lng, y: position.lat });

/** A 20 x 20 m building, corner at the origin, in the index's convention. */
const SQUARE = [at(0, 0), at(20, 0), at(20, 20), at(0, 20), at(0, 0)].map(
  planar,
);

function way(
  id: number,
  geometry: readonly LatLng[],
  tags: Record<string, string>,
): OsmFeature {
  return { type: "way", id, geometry, tags };
}

/** A road running west→east straight through the middle of `SQUARE`. */
const THROUGH = [at(-10, 10), at(30, 10)];

describe("passageOpenings", () => {
  it("finds where a building_passage way enters and leaves a footprint", () => {
    const openings = passageOpenings(
      [way(1, THROUGH, { highway: "footway", tunnel: "building_passage" })],
      [{ rings: [SQUARE] }],
    );
    // Two: in at the west wall, out at the east one. A passage that pierces a
    // building has two crossings, and both must open or the agent walks in and
    // cannot come out.
    expect(openings[0]).toHaveLength(2);
  });

  it("ignores a road that merely passes NEARBY", () => {
    const past = [at(-10, 40), at(30, 40)];
    const openings = passageOpenings(
      [way(1, past, { highway: "footway", tunnel: "building_passage" })],
      [{ rings: [SQUARE] }],
    );
    expect(openings[0]).toEqual([]);
  });

  it("ignores an ordinary road crossing the footprint in plan", () => {
    // THE WHOLE POINT OF KEYING ON THE TAG. A road crossing a building outline
    // on the map is normally running above or below it, and cutting a hole for
    // every such crossing is the rule DEC-R12-1 measured and rejected — it would
    // invent openings, and an invented opening lets an agent walk through a
    // building that is really there.
    const openings = passageOpenings(
      [way(1, THROUGH, { highway: "primary" })],
      [{ rings: [SQUARE] }],
    );
    expect(openings[0]).toEqual([]);
  });

  it("ignores `covered=yes`, which DEC-R12-3 rejected by name", () => {
    // Used for roads under canopies and arcades where the building beside them
    // is genuinely solid, so honouring it would invent passages.
    const openings = passageOpenings(
      [way(1, THROUGH, { highway: "footway", covered: "yes" })],
      [{ rings: [SQUARE] }],
    );
    expect(openings[0]).toEqual([]);
  });

  it("ignores a `tunnel=yes` road, which goes UNDER rather than through", () => {
    // A real tunnel is below the surface; `below-surface.ts` already treats the
    // two values differently for scoring, and this is the same distinction one
    // module along.
    const openings = passageOpenings(
      [way(1, THROUGH, { highway: "primary", tunnel: "yes" })],
      [{ rings: [SQUARE] }],
    );
    expect(openings[0]).toEqual([]);
  });

  it("returns one entry per footprint, in order, so the caller can zip them", () => {
    const other = [at(100, 100), at(120, 100), at(120, 120), at(100, 100)].map(
      planar,
    );
    const openings = passageOpenings(
      [way(1, THROUGH, { highway: "footway", tunnel: "building_passage" })],
      [{ rings: [SQUARE] }, { rings: [other] }],
    );
    expect(openings).toHaveLength(2);
    expect(openings[0]).toHaveLength(2);
    expect(openings[1]).toEqual([]);
  });

  it("is empty when nothing is tagged as a passage, which is the common case", () => {
    expect(
      passageOpenings(
        [way(1, THROUGH, { highway: "primary" })],
        [{ rings: [SQUARE] }],
      ),
    ).toEqual([[]]);
  });
});
