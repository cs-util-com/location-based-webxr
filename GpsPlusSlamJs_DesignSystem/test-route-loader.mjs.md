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
    `3d/playwright.config.mjs` imports it too: the lab specs import lab
    modules in Node (the runner and its workers load the config first).
  - `routeUrl(specifier, routes)` - the file URL a page path maps to under
    a route with `typescript: true`, or null for anything else: relative,
    bare and protocol-relative specifiers, a path no route claims, a route
    served as is (`/vendor/...`), or a path the server refuses (a `..`
    segment).
  - `siblingSourceUrl(specifier, parentUrl, routes)` - for a module inside a
    TypeScript route's directory, a relative `./x.js` import as its
    `./x.ts` source when `x.js` does not exist and `x.ts` does (the server
    serves `x.ts` as `x.js`; node does not rewrite it); null otherwise.
- Invariants & assumptions:
  - Only TypeScript routes are mapped; everything else falls through to
    node's own resolution.
  - A mapped module's sibling imports resolve through the same hook; its
    bare imports (`three`) resolve from its own package's `node_modules`.
    Its type-only imports must be written `import type` (node erases
    types, it does not resolve them).
- Tests: `test-route-loader.test.mjs` (the mapping against the server's
  table, the refusals, the sibling mapping and what it leaves alone, and
  the registered hook resolving and loading `/globe/sky-level.js`).
