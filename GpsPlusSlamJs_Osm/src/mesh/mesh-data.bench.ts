import { bench, describe } from "vitest";
import { MeshBuilder } from "./mesh-data.js";
import { mergeMeshes } from "./extrude.js";
import { buildBuildings } from "./buildings.js";
import { enuFrameAt } from "./enu.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import type { MeshData } from "./mesh-data.js";

/**
 * Benchmark for the ACCUMULATOR every mesh in the package is built through.
 *
 * Why this bench matters (2026-08-22 perf loop, OSM iteration 10). A `--cpu-prof`
 * of the demo's whole `buildMesh` at a 36 144-feature working set ranked
 * `MeshBuilder` as the largest single cost in the build — larger than the
 * ear-clipping quadratic two earlier iterations were spent on:
 *
 * - `build` **1 118 ms (11.3 %)** · `append` **642 ms (6.5 %)** · `vertex`
 *   **284 ms (2.9 %)** — **20.6 %** of sampled CPU between them, plus an
 *   unattributed share of the **7.7 %** spent in GC.
 *
 * **Nothing had ever benched it**, because every existing instrument here
 * measures a GEOMETRY algorithm (ear clipping, hole bridging, polygon cover) and
 * this is a data-structure cost underneath all of them. It surfaced only when
 * the profile was taken over the composition rather than over one builder — the
 * same lesson `rebuild.bench.ts` records about measuring at production scale.
 *
 * THE TWO PATHS ARE BENCHED SEPARATELY because they have different fixes and a
 * single number would hide which one moved:
 *
 * - **`vertex` + `build`** is the EMITTER path — `extrude.ts`, `roof.ts`,
 *   `roads.ts` and every POI primitive push one vertex at a time.
 * - **`append` + `build`** is the MERGE path — `mergeMeshes`, called once per
 *   chunk by `chunk-meshes.ts`, joining whole typed arrays that are already
 *   built. At the profiled working set that is 18 720 meshes and 936 432
 *   vertices merged into 12 chunks.
 *
 * SCALE IS TAKEN FROM PRODUCTION. The merge bench uses every building volume of
 * a real site rather than a synthetic count, so the mesh-size distribution — a
 * few large relations against thousands of small ways — is the real one. A
 * uniform synthetic mesh would flatten exactly the growth behaviour an
 * accumulator is sensitive to.
 *
 * Medians on devbox-win11 (Win 11 Pro, Node 24.14.1) are in `mesh-data.ts.md`,
 * alongside what changed and why it is faster.
 */

const SITE = "london-westminster";

/** Every building volume's mesh, as `chunk-meshes.ts` hands them to `mergeMeshes`. */
function buildingMeshes(): MeshData[] {
  const site = loadSite(SITE);
  const features = [...parseOverpassJson(site.payload).features];
  const volumes = buildBuildings(features, { frame: enuFrameAt(site.centre) });
  return volumes.map((volume) => volume.mesh);
}

const meshes = buildingMeshes();
const vertices = meshes.reduce((sum, m) => sum + m.positions.length / 3, 0);

describe("MeshBuilder — the merge path", () => {
  bench(`mergeMeshes (${meshes.length} meshes, ${vertices} vertices)`, () => {
    mergeMeshes(meshes);
  });
});

describe("MeshBuilder — the emitter path", () => {
  // One quad per iteration, which is what `extrude.ts` emits per wall segment.
  // The count is the same order as a chunk's worth of walls, so the growth
  // behaviour of the accumulator is exercised rather than only its steady state.
  const QUADS = 50_000;

  bench(`vertex + triangle (${QUADS * 4} vertices)`, () => {
    const builder = new MeshBuilder();
    for (let i = 0; i < QUADS; i++) {
      const a = builder.vertex(i, 0, 0, 0, 1, 0);
      const b = builder.vertex(i + 1, 0, 0, 0, 1, 0);
      const c = builder.vertex(i + 1, 1, 0, 0, 1, 0);
      const d = builder.vertex(i, 1, 0, 0, 1, 0);
      builder.triangle(a, b, c);
      builder.triangle(a, c, d);
    }
    builder.build();
  });

  // The painted variant, because `paint` turns on a THIRD parallel array and the
  // POI models — 52 builders' worth — all take that path.
  bench(`vertex + paint (${QUADS * 4} vertices)`, () => {
    const builder = new MeshBuilder();
    for (let i = 0; i < QUADS; i++) {
      builder.paint(0x8899aa);
      const a = builder.vertex(i, 0, 0, 0, 1, 0);
      const b = builder.vertex(i + 1, 0, 0, 0, 1, 0);
      const c = builder.vertex(i + 1, 1, 0, 0, 1, 0);
      const d = builder.vertex(i, 1, 0, 0, 1, 0);
      builder.triangle(a, b, c);
      builder.triangle(a, c, d);
    }
    builder.build();
  });
});
