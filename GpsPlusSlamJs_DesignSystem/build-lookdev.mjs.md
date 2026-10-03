# build-lookdev.mjs — deploy builder for the 3D look-dev page

- Purpose: assemble the deployable `/lookdev/` tree from the no-build page,
  so a PR preview (`https://<branch>-gps-plus-slam.csutil.workers.dev/lookdev/`)
  can be opened on a phone (plan 2026-09-23-0048, DEC-SKY-2).
- Public API:
  - `buildLookdev({ outDir, base, packageRoot?, routes?, entries?,
followDynamic? })` → the written paths relative to `outDir`. `base`
    must start and end with `/` (e.g. `/lookdev/`). `packageRoot` defaults
    to this package and `routes` to `serve-routes.mjs`'s table (tests pass
    fixtures). `entries` defaults to `discoverEntries(packageRoot)` (a test
    builds one page). `followDynamic` (default true) follows literal dynamic
    `import("x")`s; false gives a page's static BOOT graph only. Called by
    the workspace's `scripts/build-site.mjs`.
  - `discoverEntries(packageRoot)` → the deployable pages as URL paths:
    `/3d/index.html` first (when present), then every
    `labs/<name>/index.html`, sorted, each followed by its lab's further
    top-level pages (`*.html`, sorted: the terrain lab's `compare.html`).
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
  - follows module WORKERS too (terrain plan 2026-09-27-0605 §9, finding
    3): `new Worker(new URL("x", import.meta.url), …)` resolved against
    the naming module, `new Worker("x")` against the PAGE (the browser's
    rule for a string). A worker's graph is crawled with NO import map,
    because import maps do not apply inside a worker: a bare specifier
    there fails the build with that reason instead of 404ing on a phone.
    Any other `new URL("x", import.meta.url)` is crawled when it names a
    `.js`/`.mjs` module and copied byte for byte otherwise;
  - follows literal dynamic `import("x")`s in our own sources, outside
    comments (a JSDoc `{import("x").T}` is a type, not an import; not under
    `/vendor/`: 3d-tiles-renderer's chunks import optional packages no
    route serves), resolved with the page's import map, so a module a lab
    loads lazily is shipped (the globe's arrival prefetch at the pin press,
    round-5 plan 2026-10-01-0945 §3.6). On today's pages it adds no file;
  - scans our own sources for STATIC imports outside comments too (prose
    such as `and "The export"; DEC-...` once read as `export "..."` and
    failed the build); a vendored library is scanned as it is, since its
    strings (shader source) may hold comment markers that are not comments;
  - rewrites the page's absolute route prefixes to sit under `base`; the
    prefixes come from the route table (each route's first path segment),
    so a new route needs no second list (W7 globe plan M0);
  - copies a `copyAll` route's whole directory, binary-safe and without
    following links, when an emitted page or module references its prefix
    (fetched assets, e.g. imagery tiles, are invisible to the crawl); an
    unreferenced `copyAll` route copies nothing;
  - emits a route's `notice` file (e.g. `LICENSE`) whenever anything from
    that route is emitted (Apache-2.0 §4(a) for vendored chunks without a
    header);
  - writes an `index.html` that lists every page by its `<title>`, with
    relative links. It used to redirect to `3d/`, which would hide the labs.
  - A module or stylesheet shared by several pages is written once.
- Invariants & assumptions:
  - Labs are discovered, never listed: adding `labs/<name>/index.html` is
    all a workstream does to deploy a prototype page.
  - No bundler and no dependency: the deployed page is file-for-file what
    `pnpm run serve` shows (22 files on 2026-09-23, three's `build/` and the
    two addons included).
  - Only STATIC imports, workers and `new URL(literal, import.meta.url)`
    are followed; a dynamic `import()` or a URL built from a variable
    would need adding by hand.
  - Nothing is written outside `outDir`; `resolveRequest`'s containment
    applies to every read.
  - three comes from the framework's `node_modules/three`, so the deploy
    needs the workspace installed (CI runs `pnpm install` first).
- Examples: `buildLookdev({ outDir: "dist-site/lookdev", base: "/lookdev/" })`.
- Tests: `build-lookdev.test.mjs` (also, with fixture routes: every route's
  prefix rebased, a referenced `copyAll` route copied byte for byte, an
  unreferenced one not at all, a `notice` shipped beside its chunks; a
  module Worker by `new URL` and by string crawled with its imports and
  rebased, a non-module `new URL` asset copied byte for byte, a bare
  specifier inside a worker refused), and (stage `test:unit`) builds the real page
  into a temp dir: page and styles present, three's graph and addons
  crawled, framework TypeScript emitted stripped, every prefix rebased,
  nothing outside the output, the index. With a temp fixture package:
  entry discovery (main page first, labs sorted, folders without an index
  ignored), a lab's modules and stylesheets crawled, and the index listing
  every page by title instead of redirecting. The real terrain lab builds as
  a closed graph: its worker, the Osm library under `osm-lib/` and OsmDemo's
  heightfield under `osm/`, stripped and rebased, its fixtures not shipped.
  A dynamic import is shipped with its graph and left out when
  `followDynamic` is false; an import, static or dynamic, spelled inside a
  comment is not followed; the globe lab's static boot graph contains
  neither the Osm library, nor h3-js, nor the arrival prefetch; and a probe
  page with the prefetch's import map closes its graph (OsmDemo, the Osm
  library, the framework's OPFS store without its logger, H3, the pace).
  A one-off check on
  2026-09-23 also served the built tree statically and booted it in
  headless Chromium: no page or console error.
