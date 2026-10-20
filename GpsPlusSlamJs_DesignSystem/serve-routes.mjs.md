# serve-routes.mjs — the dev server's route table

- Purpose: decide which file a request path maps to, for `serve.mjs`.
  Pure, so it is unit-testable; the 3D look-dev page depends on it to load
  the framework's TypeScript source (plan 2026-09-23-0048 §4.1).
- Public API:
  - A route is `{ prefix, dir, typescript, copyAll?, notice? }`. `copyAll`
    and `notice` matter only to the deploy (`build-lookdev.mjs.md`).
  - `resolveRequest(pathname, { packageRoot, routes })` →
    `{ kind: "file", file, typescript }` or `{ kind: "forbidden" }`.
    `routes` are `{ prefix, dir, typescript }`; a `typescript` route maps
    `<prefix><p>.js` to `<dir>/<p>.ts`. A trailing `/` gets `index.html`.
  - **The worker view** (globe city plan 2026-10-05-0040 §12.4 R1):
    `WORKER_VIEW` (`/w/`); `resolveRequest("/w/<p>")` resolves as `<p>`
    would and adds `worker: true`. `workerModule(code, fromUrl, imports =
WORKER_IMPORTS)` returns a module's source with every import specifier
    (static, side-effect, re-export, dynamic) made a URL inside the view: a
    bare name through `imports` (exact, or the longest `prefix/` entry), a
    route path moved under `/w/`, a relative one left alone; an Error names
    a bare name `imports` does not map. `WORKER_IMPORTS` maps `h3-js`,
    `gps-plus-slam-osm` and `gps-plus-slam-app-framework/osm-bridge` the way
    the globe page's import map does (a test holds them equal). Why: import
    maps do not apply inside a worker, so a worker whose modules import a
    package by name (the Osm library imports `h3-js`) cannot load through
    the plain routes; the view lets it, in dev and deploy alike.
  - `contentType(file, typescript)` — stripped TypeScript and `.js`/`.mjs`
    are `text/javascript`; `.jpg`/`.jpeg`/`.webp` are images (the globe's
    imagery); unknown extensions are octet-stream.
- The table (`defaultRoutes`): `/fw/` (the framework's TypeScript),
  `/osm/` (OsmDemo's), `/osm-lib/` (the Osm library's, for the terrain
  lab's Terrarium decoder and ENU frame; terrain plan 2026-09-27-0605 §9
  finding 2), `/vendor/h3-js/` (the H3 library the Osm source imports by its
  bare name, for a page that maps `h3-js` to `dist/browser/h3-js.es.js`;
  its LICENSE as a notice; first user the globe's arrival prefetch, round-5
  plan 2026-10-01-0945 §3.6), `/vendor/three/` (with its LICENSE as a notice),
  and for the globe lab (W7): `/globe/` (the globe package's TypeScript),
  `/globe-assets/` (its imagery, `copyAll`), `/vendor/3d-tiles-renderer/`
  (the installed library, its LICENSE as a notice).
- Invariants & assumptions:
  - The server binds every interface, so containment is the point: the
    path is decoded once, any `..` segment or NUL byte is refused, and the
    joined path must stay inside the mapped directory. `..` is refused
    rather than normalised, because the page never needs one.
  - `.js` → `.ts` mirrors the framework's own relative-import convention.
    Extensionless imports are NOT resolved; the atmosphere directory must
    use `.js` specifiers (plan §4.1).
  - A module script must be served as JavaScript: Chromium refuses
    `application/octet-stream` for `type="module"`.
- Examples: `resolveRequest("/fw/visualization/atmosphere/atmosphere-model.js", …)`
  → `{ kind: "file", file: ".../src/visualization/atmosphere/atmosphere-model.ts", typescript: true }`.
- Tests: `serve-routes.test.mjs` (`node --test`, stage `test:unit`): index,
  directory index, TypeScript mapping, vendored files, five escape
  attempts (plain, nested, percent-encoded, encoded slash, NUL), MIME types;
  on the real table: `/osm-lib/` reaches the Osm library, `/osm/` still
  reaches OsmDemo, an escape out of `/osm-lib/` is refused, and
  `/vendor/h3-js/` serves the browser ES build with its LICENSE as a notice;
  the worker view: `/w/` resolution, escapes through it refused, every kind
  of specifier rewritten, other strings untouched, an unknown bare name
  refused by name, and `WORKER_IMPORTS` equal to the globe page's import
  map. `labs/globe/globe-worker-view.smoke.spec.mjs` loads the Osm library
  in a real worker through the view, and fails to through the plain route
  (the negative control).
