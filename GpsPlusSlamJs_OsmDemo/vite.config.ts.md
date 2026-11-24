# `vite.config.ts` - the map demo's Vite config

## Purpose

Builds the map demo: two pages (`index.html`, the demo, and `gallery.html`,
the POI model gallery) and the Web Worker the city build runs in, and sets
up error reporting's source maps.

## Configuration

- `server`: `127.0.0.1:5186`, pinned to IPv4 so Playwright's poll of
  127.0.0.1 finds the server on Windows (see the comment in the file).
- `build.rollupOptions.input`: both pages, so the gallery is in `dist` and
  not only in the dev server.
- `build.sourcemap: 'hidden'`: maps are written for the error service, but
  no bundle carries a `sourceMappingURL` comment, so a visitor's browser
  never fetches them. With the token the plugin deletes them after the
  upload, so they are not deployed; a build without the token keeps them
  beside the bundles.
- `plugins`: the error service's Vite plugin (`@sentry/vite-plugin`),
  created by the framework's shared `scripts/sentry-vite-plugins.mjs`, only
  when `SENTRY_AUTH_TOKEN` is set. In a production build it gives every
  bundle a debug id, sets the release (the commit), uploads the source maps
  to the Recorder's project and then deletes every `.map` under the
  resolved output folder (the site build's `--outDir` included); the
  reports carry an `app: osm-demo` tag (the framework's
  `utils/sentry-options.ts.md`). No build telemetry. Without the token
  (local, CI, a contributor) nothing runs and the build does not fail; a
  failed upload only warns.
- `worker.plugins`: the same plugin for the worker bundle
  (`src/worker/demo-worker.ts`), which Vite bundles on its own; it gives the
  worker its debug id. The worker's map is emitted into the page build's
  output folder, uploaded and deleted by the page build's instance.

## Invariants

- No aliases: `osm-h3` and the app framework resolve through the
  pnpm workspace links.

## Tests

- No unit test reads this file; the build (`pnpm run build`) and the e2e
  suite exercise it, both without the token. The token path was run once by
  hand: a production build with a dummy token and `SENTRY_URL` pointed at
  an unreachable local port, written to an `--outDir` outside the package.
  The config loaded under the installed Vite, the build exited 0, the
  upload failed and only warned, every page chunk and the worker bundle
  carried a debug id, and no `.map` was left in the output folder. Not
  verified: a real upload, and whether reports arrive with readable stacks,
  which is checked on a deployed preview with the `sentry-test` page flag.
