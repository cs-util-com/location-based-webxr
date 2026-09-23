# serve.mjs — LAN static server for the phone round

- Purpose: serve `index.html` over plain HTTP on all interfaces so a
  phone on the same Wi-Fi can open the design system live. Chosen over
  a hosted deploy (owner decision 2026-08-27) because iteration speed
  matters more than HTTPS: edit, save, pull-to-refresh on the phone.
  Since 2026-09-23 it also serves the 3D look-dev page at `/3d/`.
- Public API (CLI): `pnpm run serve`. Env `PORT` (default 4173) and
  `HOST` (default `0.0.0.0`; the 3D smoke and `shoot-3d.mjs` use
  `127.0.0.1` on port 5198). Prints the catalog and 3D URLs, and every
  non-internal IPv4 as a phone-ready URL when bound to all interfaces.
  Ctrl+C stops it.
- The 3D page's routes (table in `serve-routes.mjs`):
  - `/fw/<p>.js` → `GpsPlusSlamJs_AppFramework/src/<p>.ts`, types
    stripped by Node's built-in `module.stripTypeScriptTypes`;
  - `/osm/<p>.js` → `GpsPlusSlamJs_OsmDemo/src/<p>.ts`, the same way (the
    page uses OsmDemo's own `sun-position.ts`, not a copy);
  - `/vendor/three/` → the framework's `node_modules/three`, the
    lockfile-pinned copy every app uses.
- Invariants & assumptions:
  - Dependency-free (`node:http`, `node:module` only). Type stripping
    needs no esbuild: the plan's first draft proposed it, and dropping it
    kept the lockfile untouched. `stripTypeScriptTypes` is flagged
    experimental in Node 24 and 26 (verified on 26.10.0); its warning is
    silenced once per process.
  - Stripping only ERASES syntax. A served file using an enum, a parameter
    property or a type imported without `type` fails in the browser as a
    module error; a strip failure is answered with a 500 naming the reason.
  - Every route is contained: requests are decoded once, `..` segments and
    NUL bytes are refused (403), and the joined path must stay inside the
    directory it was mapped into. See `serve-routes.mjs.md`.
  - `cache-control: no-store` so a phone refresh always shows the
    latest save — caching is the enemy of a taste loop.
  - **Plain HTTP means Android blocks `getUserMedia`**: the `live`
    camera background fails with its normal error toast on the phone.
    Accepted when the LAN approach was picked; every other background
    works. WebGL needs no secure context, so the 3D page works over LAN.
- Examples: `pnpm run serve` → open the printed `http://<lan-ip>:4173/`
  (catalog) or `…/3d/` (look-dev) on the phone.
- Tests: the route table is unit-tested (`serve-routes.test.mjs`); the
  server itself is exercised by the `test:e2e` smoke, which boots it.
