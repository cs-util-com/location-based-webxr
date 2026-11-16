# sentry-vite-plugins.mjs

## Purpose

The error service's Vite plugins (`@sentry/vite-plugin`) for the apps that
report errors: the Tour Viewer and the map demo import it by relative path
from their `vite.config.ts`, the Recorder from its `config/vite.config.ts`.
One copy, so the three builds upload, tag and delete their source maps the
same way, and none deploys its maps.

Node-only and build-time, so it lives in `scripts/` and is not published.

## Public API

- `sentrySourceMapPlugins(createPlugin, env?) -> { plugins, workerPlugins }`
  - `createPlugin` is `sentryVitePlugin`, passed in: the apps depend on the
    plugin, the framework does not.
  - Without `env.SENTRY_AUTH_TOKEN` (default `process.env`): `plugins` is
    empty and `workerPlugins` returns an empty list. Nothing runs and the
    build does not fail.
  - With it: `plugins` holds a small probe that reads the resolved
    `root` and `build.outDir` (build only), and the page build's instance,
    which gives every bundle a debug id, sets the release, uploads the maps
    and then deletes every `.map` under that folder
    (`sourcemaps.filesToDeleteAfterUpload`, a promise the probe settles;
    with an empty list for an unsafe folder, see below).
    `workerPlugins` is the `worker.plugins` function: a fresh instance per
    worker build, for the worker bundle's debug id, deleting nothing.
  - Every instance: org `cs-util-com`, project `js-gps-recorder` (the
    Recorder's; reports carry an `app` tag), `telemetry: false` (no build
    telemetry to the service), and an `errorHandler` that only warns.
- `sourceMapGlob(root, outDir) -> string` - `<absolute outDir>/**/*.map` with
  forward slashes (the glob library reads a backslash as an escape).

## Invariants & assumptions

- The folder comes from the resolved config, never a fixed `./dist`: the
  site build (`scripts/build-site.mjs`) passes `--outDir dist-site/<app>`,
  where a fixed glob would match nothing and the maps would be deployed.
- The worker bundles' maps are emitted into the page build's output folder,
  so the page instance's deletion, which runs after its upload, removes them
  too.
- The maps are deleted even when the upload fails (the plugin deletes after
  its upload step whatever its outcome): a failed upload costs readable
  stacks for that build. The deletion itself can fail too, and the plugin
  only logs that, so this module alone does not keep a map out of the
  deploy: the site build's `scripts/source-maps-deploy.mjs` check fails a
  build with the token that left a `.map` under `recorder/`, `tour/` or
  `osm/`.
- An output folder that is the project root, holds it, or is a filesystem
  root deletes nothing (the glob would reach every map below it,
  node_modules included); the site build's check then fails on the maps
  left behind.

## Verification

- `sentry-vite-plugins.test.mjs` - nothing without the token; the page
  instance's deletion glob follows a resolved `outDir` outside the package
  (checked against the literal path, not against `sourceMapGlob`); an
  unsafe `outDir` deletes nothing; workers delete nothing; no telemetry; a
  failed upload only warns.
- No CI workflow sets `SENTRY_AUTH_TOKEN`, so no gate runs the real plugin.
  A local build with a dummy token, `SENTRY_URL` pointed at an unreachable
  local port, was run once by hand, for the map demo only, to check that
  the config loads under the installed Vite, the debug ids reach the worker
  bundle and the maps are deleted (see the apps' `vite.config.ts.md`). Whether a real upload
  succeeds and the deployed stacks read back is checked only on a deploy
  with the token, through the `sentry-test` page flag.
