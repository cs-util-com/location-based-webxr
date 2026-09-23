# build-lookdev.mjs — deploy builder for the 3D look-dev page

- Purpose: assemble the deployable `/lookdev/` tree from the no-build page,
  so a PR preview (`https://<branch>-gps-plus-slam.csutil.workers.dev/lookdev/`)
  can be opened on a phone (plan 2026-09-23-0048, DEC-SKY-2).
- Public API: `buildLookdev({ outDir, base })` → the written paths relative
  to `outDir`. `base` must start and end with `/` (e.g. `/lookdev/`).
  Called by the workspace's `scripts/build-site.mjs`.
- How it works:
  - reads `3d/index.html` and its import map;
  - copies the files the HTML references by `<link>` (`3d/lookdev.css`,
    `design.css`);
  - follows static `import`/`export … from` specifiers from the module
    script, resolving relative, absolute and import-mapped ones, through
    `serve-routes.mjs`'s `defaultRoutes` (the SAME table the dev server
    uses), stripping TypeScript with `module.stripTypeScriptTypes`;
  - rewrites the page's absolute `/fw/`, `/osm/`, `/vendor/` prefixes to sit
    under `base`;
  - adds an `index.html` that forwards to `3d/`.
- Invariants & assumptions:
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
  nothing outside the output, the forwarding index. A one-off check on
  2026-09-23 also served the built tree statically and booted it in
  headless Chromium: no page or console error.
