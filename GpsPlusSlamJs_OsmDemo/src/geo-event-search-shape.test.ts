import { describe, expect, it } from "vitest";
import { CANDIDATES_PER_BATCH, SCORE_DISK_MAX_RADIUS } from "gps-plus-slam-osm";
import type { OsmDataSource, OsmFeature } from "gps-plus-slam-osm";
import { parseRuleTable } from "gps-plus-slam-osm";

import { DemoPipeline } from "./demo-pipeline.js";

/**
 * WHY THIS TEST MATTERS — it measures the two assumptions the geo-event
 * diagnosis rests on, and neither had ever been counted.
 *
 * The reported defect is that an event never lands on the Tower of London even
 * though `battleArea` scores very high there. The proposed explanation is that
 * the search is "throw ten darts, nudge each a few metres uphill, take the
 * best", which would find a big peak only if a dart landed almost on it. Two
 * claims carry that explanation:
 *
 * 1. **Round one almost always wins.** The quality gate is an absolute floor
 *    meaning roughly "is anything mapped here", so in a place with data every
 *    batch passes and the nine retry batches never run — 10 candidates are
 *    evaluated, not 100.
 * 2. **A climb travels far less than its 35 m ceiling.** `CLIMB_STEPS = 5` at a
 *    7.09 m res-13 spacing allows ~35 m, but greedy ascent stops at the first
 *    local maximum, and mapped ground is full of small ones.
 *
 * **If either is false the diagnosis is wrong**, and so is every fix built on
 * it. That is why this lands before any change.
 *
 * THE FIELD HAS TO HAVE A GRADIENT, which is the trap here. The existing
 * `wideSource` fixture is a single uniform park: every cell scores identically,
 * so a climb has nothing to climb and stops after one step **for a reason that
 * has nothing to do with the defect**. Measuring hypothesis 2 against it would
 * produce a confident "climbs do not travel" that was really "there was no
 * hill". So this builds a graded field — a low background, scattered small
 * bumps, and one large high peak — which is the shape the real complaint is
 * about.
 */

const AT = { lat: 50.9413, lng: 6.9583 };

/** Background, small bumps, and one big peak — a field with somewhere to go. */
const TABLE = parseRuleTable(
  [
    "id,Key,Value,battleArea",
    "landuse_grass,landuse,grass,2",
    "leisure_park,leisure,park,6",
    "historic_castle,historic,castle,40",
  ].join("\n"),
  { source: "test", fetchedAt: 0 },
);

const square = (
  id: number,
  centre: { lat: number; lng: number },
  halfDeg: number,
  tags: Record<string, string>,
): OsmFeature => ({
  type: "way",
  id,
  geometry: [
    { lat: centre.lat - halfDeg, lng: centre.lng - halfDeg },
    { lat: centre.lat - halfDeg, lng: centre.lng + halfDeg },
    { lat: centre.lat + halfDeg, lng: centre.lng + halfDeg },
    { lat: centre.lat + halfDeg, lng: centre.lng - halfDeg },
    { lat: centre.lat - halfDeg, lng: centre.lng - halfDeg },
  ],
  tags,
});

/**
 * A graded field over the whole event tile.
 *
 * The peak is offset from `AT` so it is somewhere a dart has to FIND, rather
 * than sitting under the user where every search would trivially reach it.
 */
function gradedSource(): OsmDataSource {
  const features: OsmFeature[] = [
    // ~1.1 km of background, comfortably covering the res-8 event tile.
    square(1, AT, 0.005, { landuse: "grass" }),
    // The peak — ~110 m across, ~330 m north-east of the user.
    square(2, { lat: AT.lat + 0.003, lng: AT.lng + 0.003 }, 0.0005, {
      historic: "castle",
    }),
  ];
  // Small bumps scattered across the tile: the local maxima a greedy climb
  // stops on. Deterministic positions — a random layout would make the counts
  // below vary between runs for reasons unrelated to the algorithm.
  let id = 10;
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      if (i === 0 && j === 0) continue;
      features.push(
        square(
          id++,
          { lat: AT.lat + i * 0.0009, lng: AT.lng + j * 0.0009 },
          0.0002,
          { leisure: "park" },
        ),
      );
    }
  }

  return {
    attribution: "© OpenStreetMap contributors",
    sourceId: "fixture:graded",
    fetchTile: (tile) =>
      Promise.resolve({
        tile,
        features,
        fetchedAt: 0,
        sourceId: "fixture:graded",
        schemaVersion: 1,
        skipped: [],
      }),
  };
}

/** Metres between two positions, flat-earth — adequate over one tile. */
function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Distinct event times, at least a minute apart.
 *
 * **THE SEED IS QUANTISED TO WHOLE MINUTES**, so times closer than 60 000 ms
 * produce identical candidates and the samples silently collapse into one. A
 * distribution over duplicates looks like a measurement and is not.
 */
const TIMES = Array.from(
  { length: 24 },
  (_, i) => 1_700_000_000_000 + i * 15 * 60_000,
);

describe("the geo-event search's actual shape", () => {
  it("measures how many batches run, and how far climbs travel", async () => {
    const pipeline = new DemoPipeline({ source: gradedSource(), table: TABLE });
    await pipeline.update(AT, "battleArea", undefined, SCORE_DISK_MAX_RADIUS);

    const batchesPerSearch: number[] = [];
    const travelled: number[] = [];

    for (const time of TIMES) {
      const { event, stats } = await pipeline.geoEvent(AT, "battleArea", time);
      // `climbsStarted` counts one per candidate evaluated, summed across every
      // tile searched — so the batch count has to be divided by the tile count
      // too. Measured rather than assumed: this search reaches TWO tiles from
      // the demo's own position, and dividing by the batch size alone (the
      // first version of this test) would have reported exactly double.
      expect(event.tilesSearched).toBeGreaterThan(0);
      batchesPerSearch.push(
        stats.climbsStarted / (CANDIDATES_PER_BATCH * event.tilesSearched),
      );
      for (const pick of event.picks) {
        travelled.push(metresBetween(pick.candidate, pick.position));
      }
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const roundOneOnly = batchesPerSearch.filter((n) => n <= 1).length;

    // eslint-disable-next-line no-console -- the measurement IS the output
    console.log(
      `[geo-event shape] searches=${TIMES.length} ` +
        `round-1-only=${roundOneOnly}/${TIMES.length} ` +
        `mean batches=${mean(batchesPerSearch).toFixed(2)} ` +
        `max batches=${Math.max(...batchesPerSearch)} | ` +
        `climbs=${travelled.length} mean travel=${mean(travelled).toFixed(1)} m ` +
        `max travel=${Math.max(...travelled).toFixed(1)} m ` +
        `(ceiling ~35 m)`,
    );

    // Loose bounds only. This test exists to REPORT the two numbers, not to
    // pin them — pinning a distribution before anyone has seen it is how a
    // measurement becomes an assertion of what someone hoped for.
    expect(batchesPerSearch.length).toBe(TIMES.length);
    expect(travelled.length).toBeGreaterThan(0);
    expect(Math.max(...travelled)).toBeLessThan(60);
  });
});
