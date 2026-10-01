# gps-plus-slam-globe (private)

The globe intro's code (W7 phase 1): an Earth drawn from open imagery with
[3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS),
served no-build to the design system's globe lab
(`GpsPlusSlamJs_DesignSystem/labs/globe/`). OsmDemo consumes it in phase 5.
Design: the private repo's `GpsPlusSlamJs_Docs/docs/2026-09-26-0539-globe-intro-start-scene-plan.md` §7.

## The dependency exception (DEC-PRG-4)

The workspace keeps production code dependency-free. `3d-tiles-renderer`
is the one recorded exception, contained in this private package:

- pinned EXACTLY (`0.5.3`): 0.x minors have broken APIs; an upgrade is its
  own commit, with the globe lab's smoke run;
- `three` is a peer; the lab maps it to the framework's copy, so a page runs
  one three (a repo-config test holds the two installed versions equal);
- it pulls eight transitive packages (for `pnpm audit`):
  `@mapbox/vector-tile`, `@mapbox/point-geometry`, `@types/geojson`,
  `pbf`, `resolve-protobuf-schema`, `protocol-buffers-schema`,
  `pmtiles`, `fflate`. The page never loads them: they sit behind dynamic
  `import()` in the vector-tile plugins;
- Apache-2.0 §4(a): its build chunks carry no licence header, so the
  look-dev deploy ships `LICENSE` beside them (the route's `notice`).

## The imagery

`assets/` holds the imagery, committed (DEC-PRG-12; level 4 added by
DEC-FB2-4, level 5 by round 4's DEC-GL4-3, about 2.4 km a pixel; WebP
since round 4, DEC-GL4-10; 8.85 MB against the 10 MB budget DEC-GL4-9
that `globe-sources.test.ts` holds): the Blue Marble tile pyramid (EPSG:4326, WebP,
the water mask in each tile's alpha, DEC-GL4-6) and two global maps (night
lights, clouds), all NASA, public domain.
`scripts/fetch-globe-assets.mjs` regenerates them by hand (never in CI) and
writes `assets/PROVENANCE.md`. `src/globe-sources.ts` is the one registry
the globe loads from, so every source carries its credit.

## The recorded patch (DEC-PRG-14)

`patches/3d-tiles-renderer@0.5.3.patch` (at the workspace root, wired in
`pnpm-workspace.yaml`'s `patchedDependencies`) changes one rule: a child
tile that FAILED to load counts as not ready, so its parent stays drawn
over that area instead of leaving a hole. The library's build is what the
page runs, so the patch edits the bundled chunk (two places) and, for
readers, the same line in `src/`. The globe lab's smoke proves it: with
every level 2-3 tile answering 404, no probe is black (81 of 81 were
without the patch). Upstream it stays to be reported; an upgrade must
re-check whether the patch still applies.

## How it is served

The design system's route table (`serve-routes.mjs`) maps `/globe/` to
`src/` (TypeScript, type-stripped on the fly), `/globe-assets/` to
`assets/` (copied whole by the deploy), and `/vendor/3d-tiles-renderer/`
to the installed library. So the source keeps to the served dialect:
`.js`-suffixed relative imports, only the lab's import-mapped bare
specifiers, and erasable syntax (`verbatimModuleSyntax`,
`erasableSyntaxOnly`). A root repo-config test walks the graph.

## Gate

`pnpm test`: format, lint, check:cycles, typecheck, typecheck:tests,
test:unit (vitest, Node). No build and no e2e: the browser check is the
globe lab's smoke in the design system, which `test:changed` selects on
any change here (the served-by edge).
