# build-lookdev.mjs — deploy builder for the 3D look-dev page

- Purpose: assemble the deployable `/lookdev/` tree from the no-build page,
  so a PR preview (`https://<branch>-gps-plus-slam.csutil.workers.dev/lookdev/`)
  can be opened on a phone (plan 2026-09-23-0048, DEC-SKY-2).
- Public API:
  - `buildLookdev({ outDir, base, packageRoot? })` → the written paths
    relative to `outDir`. `base` must start and end with `/` (e.g.
    `/lookdev/`). `packageRoot` defaults to this package (tests pass a
    fixture). Called by the workspace's `scripts/build-site.mjs`.
  - `discoverEntries(packageRoot)` → the deployable pages as URL paths:
    `/3d/index.html` first (when present), then every
    `labs/<name>/index.html`, sorted.
- How it works:
  - for every page from `discoverEntries` (the main page and the lab
    pages, programme plan 2026-09-26-0539 DEC-PRG-2): reads it and its
    import map (none is fine for a page without mapped imports);
  - copies the stylesheets each page links (`<link rel="stylesheet">`,
    external font sheets skipped);
  - follows static `import`/`export … from` specifiers from the module
    script, resolving relative, absolute and import-mapped ones, through
    `serve-routes.mjs`'s `defaultRoutes` (the SAME table the dev server
    uses), stripping TypeScript with `module.stripTypeScriptTypes`;
  - rewrites the page's absolute `/fw/`, `/osm/`, `/vendor/` prefixes to sit
    under `base`;
  - writes an `index.html` that lists every page by its `<title>`, with
    relative links. It used to redirect to `3d/`, which would hide the labs.
  - A module or stylesheet shared by several pages is written once.
- Invariants & assumptions:
  - Labs are discovered, never listed: adding `labs/<name>/index.html` is
    all a workstream does to deploy a prototype page.
  - No bundler and no dependency: the deployed page is file-for-file what
    `pnpm run serve` shows (22 files on 2026-09-23, three's `build/` and the
    two addons included).
  - Only STATIC imports are followed; a dynamic `import()` in the page
    would need adding by hand.
  - Nothing is written outside `outDir`; `resolveRequest`'s containment
    applies to every read.
  - three comes from the framework's `node_modules/three`, so the deploy
    needs the workspace installed (CI runs `pnpm install` first).
- Examples: `buildLookdev({ outDir: "dist-site/lookdev", base: "/lookdev/" })`.
- Tests: `build-lookdev.test.mjs` (stage `test:unit`) builds the real page
  into a temp dir: page and styles present, three's graph and addons
  crawled, framework TypeScript emitted stripped, every prefix rebased,
  nothing outside the output, the index. With a temp fixture package:
  entry discovery (main page first, labs sorted, folders without an index
  ignored), a lab's modules and stylesheets crawled, and the index listing
  every page by title instead of redirecting. A one-off check on
  2026-09-23 also served the built tree statically and booted it in
  headless Chromium: no page or console error.
