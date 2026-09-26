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
  - `contentType(file, typescript)` — stripped TypeScript and `.js`/`.mjs`
    are `text/javascript`; `.jpg`/`.jpeg`/`.webp` are images (the globe's
    imagery); unknown extensions are octet-stream.
- The table (`defaultRoutes`): `/fw/` (the framework's TypeScript),
  `/osm/` (OsmDemo's), `/vendor/three/` (with its LICENSE as a notice),
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
  attempts (plain, nested, percent-encoded, encoded slash, NUL), MIME types.
