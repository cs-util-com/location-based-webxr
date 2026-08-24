import { readFileSync } from "node:fs";
import { bench, describe } from "vitest";
import {
  AffordanceIndex,
  enuFrameAt,
  parseOverpassJson,
  snapshotRuleTable,
  OVERPASS_SCHEMA_VERSION,
  SCORE_DISK_MAX_RADIUS,
  type OsmTileResult,
} from "gps-plus-slam-osm";

import { buildCellMesh, type DrawableCell } from "./cell-mesh.js";
import { fixedScale } from "./heat-colours.js";
import { drawMeshLayers } from "./mesh-layers.js";
import { DEFAULT_CATEGORY } from "./default-category.js";
import type { TransferableMesh } from "./worker/protocol.js";

/**
 * Benchmark for the demo's rebuild path — the first measurement this package has
 * ever had (2026-08-09 perf loop, OSM iteration 8, an owner-approved scope
 * extension).
 *
 * WHICH THREAD EACH OF THESE IS ON, because getting it wrong changes the
 * verdict and this file got it wrong first:
 *
 * - `drawMeshLayers` runs on the MAIN thread, per render. It wraps typed arrays
 *   the worker transferred in `BufferGeometry` — pure object construction, no
 *   per-vertex JS.
 * - `buildCellMesh` runs in the WORKER, and has since W8 / DEC-R4-4, which moved
 *   it there for precisely the reason it is benched here: it calls
 *   `cellToBoundary` once per drawn cell, thousands of times. `cell-mesh-cycle.ts`
 *   also coalesces it, because five separate triggers rebuild the grid. So its
 *   cost delays the overlay appearing; it does not block interaction.
 *
 * Neither needs a GPU, so both are honestly measurable in Node. **The actual
 * `renderer.render` is not**, and is deliberately absent rather than
 * approximated — it is GPU and compositor work, which the loop's desktop-only
 * decision already parks for a real-browser trace.
 *
 * SCALE IS TAKEN FROM THE DEMO, NOT FROM CONVENIENCE. `buildCellMesh` is fed the
 * cells a real fixture scores at `SCORE_DISK_MAX_RADIUS` — ~6 223 of them at
 * the current radius of 6 — because that is what scoring eventually covers.
 *
 * ⚠️ **THE RADIUS IS READ FROM THE CONSTANT NOW, AND USED TO BE THE LITERAL 4.**
 * That made this bench blind to exactly the change it is the instrument for:
 * DEC-K1 raised the radius and this file would have reported two identical
 * numbers, which reads as "the extra rings were free". A benchmark that cannot
 * see the change it is quoted for is worse than none, because the number gets
 * believed. Caught by the cold review of that plan. An earlier iteration measured
 * `regions/` over the 931-cell radius-2 disk that the existing benches use and
 * got a third of the true cost, which is the mistake this file exists not to
 * repeat.
 *
 * `showBelowThreshold: true` is the expensive case AND the honest default to
 * bench: it draws every cell rather than only those above the bar.
 *
 * Measured on devbox-win11 (Win 11 Pro, Node 24.14.1, pnpm 11.11.0):
 *
 * - `buildCellMesh` — park **9.9 ms** (2 718 cells), building-block **13.9 ms**
 *   (6 223 cells). **43 % of that is `cellToBoundary`** (5.9 ms for 6 223 cells,
 *   against 0.094 ms to serve the same lookups from a `Map`).
 * - `drawMeshLayers` — **0.18 ms** at 9 chunks per layer, **0.49 ms** at 27.
 *   Nothing to gain; it is the cheap half by two orders of magnitude.
 */

const table = snapshotRuleTable();

/** The cells a fixture scores over the full working set, as the overlay sees them. */
function drawableCells(slug: string): {
  cells: DrawableCell[];
  centre: { lat: number; lng: number };
} {
  // `loadFixture` is test-only in the osm package, so the payload is read the
  // way the demo's own fixtures are: through the published parser.
  const raw = fixturePayload(slug);
  const parsed = parseOverpassJson(raw.payload);
  const tile: OsmTileResult = {
    tile: raw.tile,
    features: parsed.features,
    fetchedAt: raw.capturedAt,
    sourceId: "bench",
    schemaVersion: OVERPASS_SCHEMA_VERSION,
    skipped: [],
  };

  const index = new AffordanceIndex({ table });
  index.acceptTile(tile);
  index.update(raw.centre, SCORE_DISK_MAX_RADIUS);
  return { cells: [...index.scoresByCell().values()], centre: raw.centre };
}

interface FixturePayload {
  readonly payload: unknown;
  readonly tile: string;
  readonly capturedAt: number;
  readonly centre: { lat: number; lng: number };
}

function fixturePayload(slug: string): FixturePayload {
  const path = new URL(
    `../../GpsPlusSlamJs_Osm/src/testdata/${slug}.json`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(path, "utf8")) as FixturePayload;
}

describe("buildCellMesh — the affordance overlay, in the worker", () => {
  for (const slug of ["park", "building-block"]) {
    const { cells, centre } = drawableCells(slug);
    const frame = enuFrameAt(centre);
    // FIXED, as the demo now is (DEC-H5) — the bench must feed the mesh the
    // same scale the app does, or it measures a ramp nothing draws.
    const scale = fixedScale(1);

    bench(`${slug} (${cells.length} cells)`, () => {
      buildCellMesh(cells, {
        frame,
        category: DEFAULT_CATEGORY,
        threshold: 1,
        scale,
        showBelowThreshold: true,
      });
    });
  }
});

/**
 * A mesh whose SHAPE is synthetic but whose SIZES are the measured ones.
 *
 * Said plainly because it is the weaker half of this file: the worker's real
 * output for `london-westminster` is ~9 chunks per layer carrying a few thousand
 * triangles each, and this reproduces those counts without reproducing the
 * geometry. That is enough to measure `BufferGeometry` construction, which is
 * what the layer table does, and not enough to claim anything about the
 * geometry itself.
 */
function sizedMesh(
  chunks: number,
  trianglesPerChunk: number,
): TransferableMesh {
  const chunk = (): { key: string; mesh: MeshBuffers } => {
    const vertices = trianglesPerChunk * 3;
    return {
      key: "0,0",
      mesh: {
        positions: new Float32Array(vertices * 3),
        normals: new Float32Array(vertices * 3),
        indices: new Uint32Array(vertices),
        triangleCount: trianglesPerChunk,
      },
    };
  };
  const list = Array.from({ length: chunks }, chunk);
  return {
    buildings: list,
    trees: [],
    plates: list,
    plateCount: chunks,
    poi: [],
    roads: list,
    roadCount: chunks,
    regions: [],
  } as unknown as TransferableMesh;
}

interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
}

describe("drawMeshLayers — typed arrays to three.js objects, main thread", () => {
  for (const [chunks, triangles] of [
    [9, 2000],
    [27, 2000],
  ] as const) {
    const mesh = sizedMesh(chunks, triangles);

    bench(`${chunks} chunks x ${triangles} triangles per layer`, () => {
      drawMeshLayers(mesh);
    });
  }
});
