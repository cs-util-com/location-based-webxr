import { defineConfig } from "tsdown";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// Explicit per-file entry list, same convention (and same reason) as
// GpsPlusSlamJs_AppFramework/config/tsdown.config.ts: the package's `exports`
// field advertises wildcard subpaths (e.g. `./model/*` -> `./dist/model/*.js`),
// so tsdown must emit a per-file artifact for every public `.ts` source file.
// The list is intentionally NOT a glob, so adding a public subpath is a
// deliberate, PR-visible change. Keep in sync with package.json `exports`.
// Grown one iteration at a time, in lockstep with package.json `exports` — a
// tsdown entry for a file that does not exist yet fails the build, so this list
// is the honest record of what the package currently ships.
const entryFiles = [
  // Root barrel
  "src/index.ts",

  // model/ — typed OSM domain model, pure, no I/O
  "src/model/index.ts",
  "src/model/osm-feature.ts",
  "src/model/osm-tags.ts",
  "src/model/osm-geometry.ts",
  "src/model/multipolygon-builder.ts",
  "src/model/overpass-parser.ts",

  // source/ — data acquisition; the only place that touches the network
  "src/source/index.ts",
  "src/source/osm-data-source.ts",
  "src/source/osm-blob-store.ts",
  "src/source/memory-blob-store.ts",
  "src/source/overpass-query.ts",
  "src/source/backoff.ts",
  "src/source/overpass-source.ts",
  "src/source/caching-source.ts",
  "src/source/fixture-source.ts",
  "src/source/overpass-status.ts",
  "src/source/slot-budget.ts",
  "src/source/area-loader.ts",

  // spatial/ — H3 indexing (named `spatial/`, not the plan's `index/`, to avoid
  // colliding with the `src/index.ts` barrel — see the plan's deviation log)
  "src/spatial/index.ts",
  "src/spatial/resolutions.ts",
  "src/spatial/merge-tiles.ts",
  "src/spatial/cell-coverage.ts",
  "src/spatial/h3-feature-index.ts",
  "src/spatial/chunk-cells.ts",
  "src/spatial/clip.ts",

  // rules/ — the policy layer: loads and validates the affordance rule table
  "src/rules/index.ts",
  "src/rules/rule-table.ts",
  "src/rules/rule-table-loader.ts",
  "src/rules/ignored-tags.ts",
  "src/rules/csv.ts",

  // score/ — the multiplicative affordance kernel
  "src/score/index.ts",
  "src/score/affordance-scorer.ts",
  "src/score/affordance-index.ts",

  // regions/ — contiguous above-threshold cells with exact outlines
  "src/regions/index.ts",
  "src/regions/connected-components.ts",
  "src/regions/region-builder.ts",

  // elevation/ — the provider seam, Terrarium rasters, and the geoid
  "src/elevation/index.ts",
  "src/elevation/elevation-provider.ts",
  "src/elevation/terrarium.ts",
  "src/elevation/opentopodata-provider.ts",
  "src/elevation/geoid.ts",
  // The EGM96 grid is ~170 KB and is NOT in the elevation barrel, so an app
  // that does not need absolute heights never pays for it. Own entry point.
  "src/elevation/egm96.ts",
  "src/elevation/egm96-grid.ts",

  // mesh/ — OSM features to renderable geometry, as plain typed arrays
  "src/mesh/index.ts",
  "src/mesh/enu.ts",
  "src/mesh/triangulate.ts",
  "src/mesh/building-heights.ts",
  "src/mesh/mesh-data.ts",
  "src/mesh/extrude.ts",
  "src/mesh/roof.ts",
  "src/mesh/buildings.ts",
  "src/mesh/trees.ts",
];

export default defineConfig({
  entry: entryFiles.map((p) => resolve(projectRoot, p)),
  tsconfig: resolve(projectRoot, "tsconfig.app.json"),
  format: ["esm"],
  dts: true,
  outDir: resolve(projectRoot, "dist"),
  clean: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  deps: {
    // h3-js is a peer dependency: it must resolve to the consumer's copy, not a
    // second bundled one. Two h3-js instances would silently produce two
    // incompatible cell-index universes.
    neverBundle: ["h3-js"],
  },
});
