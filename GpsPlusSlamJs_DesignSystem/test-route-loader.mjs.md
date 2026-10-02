# test-route-loader.mjs - the dev server's routes under `node --test`

- Purpose: lets a lab's pure module import another package's TypeScript
  source by its page path (first user: the terrain lab's `terrain-sun.js`
  importing `/globe/sky-level.js`, the Globe package's one sky level) and
  still run under node's own test runner. The browser gets the file from
  the dev server's route table (`serve-routes.mjs`); this hook resolves the
  same path through the SAME table, so the tests load the file the page
  loads. Node strips the types.
- Public API:
  - Importing it registers a synchronous resolve hook
    (`module.registerHooks`). `test:unit` passes
    `--import ./test-route-loader.mjs` (in
    `scripts/test-timing/projects.mjs`), which node forwards to every test
    file's process.
  - `routeUrl(specifier, routes)` - the file URL a page path maps to under
    a route with `typescript: true`, or null for anything else: relative,
    bare and protocol-relative specifiers, a path no route claims, a route
    served as is (`/vendor/...`), or a path the server refuses (a `..`
    segment).
- Invariants & assumptions:
  - Only TypeScript routes are mapped; everything else falls through to
    node's own resolution.
  - The mapped module's OWN imports are resolved by node as written: a
    TypeScript source that imports a sibling as `./x.js` would not load
    (node does not rewrite `.js` to `.ts`). So a module imported this way
    must be dependency-free, as `sky-level.ts` is.
- Tests: `test-route-loader.test.mjs` (the mapping against the server's
  table, the refusals, and the registered hook resolving and loading
  `/globe/sky-level.js`).
