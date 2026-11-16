# sentry-vite-plugins.mjs

## Purpose

The error service's Vite plugins (`@sentry/vite-plugin`) for the apps
visitors use: the Tour Viewer and the map demo import it by relative path
from their `vite.config.ts`. One copy, so the two builds upload, tag and
delete their source maps the same way. The Recorder keeps its own call in
`config/vite.config.ts` (public maps, no deletion).

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
    (`sourcemaps.filesToDeleteAfterUpload`, a promise the probe settles).
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
  stacks for that build, never a deployed map.

## Verification

- `sentry-vite-plugins.test.mjs` - nothing without the token; the page
  instance's deletion glob follows a resolved `outDir` outside the package;
  workers delete nothing; no telemetry; a failed upload only warns.
- No CI workflow sets `SENTRY_AUTH_TOKEN`, so no gate runs the real plugin.
  A local build with a dummy token, `SENTRY_URL` pointed at an unreachable
  local port, was run once by hand, for the map demo only, to check that
  the config loads under the installed Vite, the debug ids reach the worker
  bundle and the maps are deleted (see the apps' `vite.config.ts.md`). Whether a real upload
  succeeds and the deployed stacks read back is checked only on a deploy
  with the token, through the `sentry-test` page flag.
