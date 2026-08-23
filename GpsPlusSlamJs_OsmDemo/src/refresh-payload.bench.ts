/**
 * Cell-payload packing benchmark — the wall-clock half of what
 * `refresh-payload.test.ts` used to assert.
 *
 * **WHY IT LIVES HERE AND NOT IN THE GATE.** The claim it defends is real and
 * it corrected a design: measured 2026-08-04 at 24 206 cells,
 * `structuredClone` 27.1 ms, `packCells` 17.3 ms, `unpackCells` 10.8 ms — so
 * pack alone beats the clone, pack PLUS unpack does not (28.1 against 27.1),
 * and therefore **`unpackCells` is for tests and for a resync path, never for
 * the render path**. The first version of that change did exactly that and only
 * this measurement caught it.
 *
 * As a gate assertion it was hardened three times and failed a fourth:
 *
 * 1. one timed run, no margin — lost a coin toss at 67.59 vs 66.84 ms (1 %);
 * 2. best-of-five plus a `× 0.9` ratio — still failed 3 of 20 CI runs;
 * 3. wall clock skipped under `env.CI` — then failed on a DEVELOPER machine
 *    merely because a second gate ran beside it, measuring pack 65.8 ms against
 *    clone 55.0 ms on code that had not changed.
 *
 * The margin was never the problem. A relative wall-clock claim cannot live in a
 * correctness gate: a gate that must be green to commit is the worst place for a
 * load-sensitive measurement, because it fires under contention — which is
 * exactly when the session-end cascade and CI run. See
 * `GpsPlusSlamJs_Docs/docs/2026-08-20-0847-wall-clock-assertions-in-the-unit-gate-followup.md`.
 *
 * **What the gate kept**, in `refresh-payload.test.ts`: that the packed form
 * still describes every cell it was given, which is machine-independent, plus
 * the design rule above written where a reader of the render path will meet it.
 *
 * Run with: `pnpm run bench`
 */
import { bench, describe } from "vitest";
import {
  SCORE_DISK_RADIUS,
  parseRuleTable,
  type OsmDataSource,
} from "gps-plus-slam-osm";

import { DemoPipeline } from "./demo-pipeline.js";
import { packCells, unpackCells } from "./cell-payload.js";

const COLOGNE = { lat: 50.9375, lng: 6.9603 };

/**
 * Ground with SEVERAL overlapping features — the same fixture the test file
 * uses, and representative rather than convenient: a cell touched by one
 * feature costs almost nothing, and real ground produces several.
 */
function overlappingFeatures() {
  const box = (dLat: number, dLng: number, size: number) => [
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng + dLng },
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng + dLng + size },
    { lat: COLOGNE.lat + dLat + size, lng: COLOGNE.lng + dLng + size },
    { lat: COLOGNE.lat + dLat + size, lng: COLOGNE.lng + dLng },
    { lat: COLOGNE.lat + dLat, lng: COLOGNE.lng + dLng },
  ];
  return [
    {
      type: "way" as const,
      id: 1,
      geometry: box(-0.004, -0.004, 0.008),
      tags: { leisure: "park", surface: "grass" },
    },
    {
      type: "way" as const,
      id: 2,
      geometry: box(-0.003, -0.003, 0.006),
      tags: { highway: "footway" },
    },
    {
      type: "way" as const,
      id: 3,
      geometry: box(-0.002, -0.002, 0.004),
      tags: { natural: "wood" },
    },
  ];
}

const source: OsmDataSource = {
  attribution: "© OpenStreetMap contributors",
  sourceId: "fixture:refresh-payload-bench",
  fetchTile: (tile) =>
    Promise.resolve({
      tile,
      features: overlappingFeatures(),
      fetchedAt: 0,
      sourceId: "fixture:refresh-payload-bench",
      schemaVersion: 1,
      skipped: [],
    }),
};

const TABLE = parseRuleTable(
  [
    "id,Key,Value,walkable,scenic",
    "leisure_park,leisure,park,3,4",
    "highway_footway,highway,footway,4,2",
    "natural_wood,natural,wood,2,5",
    "surface_grass,surface,grass,2,3",
  ].join("\n"),
  { source: "bench", fetchedAt: 0 },
);

/**
 * Cap-scale cells, built once outside the benched bodies.
 *
 * Top-level await so every `bench` measures ONLY the operation named in it —
 * building the fixture inside a body would fold ~24 k cells of pipeline work
 * into the number and make all three arms look identical.
 */
const pipeline = new DemoPipeline({ source, table: TABLE });
const snapshot = await pipeline.update(COLOGNE, "walkable");
const CAP_MULTIPLE = 26;
const atCap = Array.from({ length: CAP_MULTIPLE }, (_, copy) =>
  snapshot.cells.map((cell) => ({
    ...cell,
    // Distinct ids, and still VALID H3 hex — `packCells` parses them as 64-bit
    // integers, so a `#0` suffix would throw rather than measure.
    cell: cell.cell.slice(0, -1) + "0123456789abcdef"[copy % 16],
  })),
).flat();
const packed = packCells(atCap);

void SCORE_DISK_RADIUS;

describe(`cell payload at cap scale (${String(atCap.length)} cells)`, () => {
  // THE COMPARISON IS ONLY HONEST IF IT COUNTS BOTH ENDS. The transfer itself
  // is O(1) regardless of size, so `pack + unpack` is the entire replacement
  // cost for `structuredClone` — and reading the two pack arms separately is
  // what shows why unpacking must stay off the render path.
  bench("structuredClone (what packing replaces)", () => {
    void structuredClone(atCap);
  });

  bench("packCells (worker side)", () => {
    void packCells(atCap);
  });

  bench("unpackCells (main-thread side — NOT on the render path)", () => {
    void unpackCells(packed);
  });
});
