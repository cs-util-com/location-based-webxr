# `scripts/source-maps-deploy.mjs` - no uploaded source map in the deploy

## Purpose

The Recorder, the Tour Viewer and the map demo upload their source maps to the error
service when `SENTRY_AUTH_TOKEN` is set, and delete them from their output
folders afterwards
(`GpsPlusSlamJs_AppFramework/scripts/sentry-vite-plugins.mjs`). The upload
plugin only logs a failed delete, so without this check such a build stays
green and deploys the maps. `scripts/build-site.mjs` calls it after those
apps are built.

## Public API

- `SOURCE_MAP_FREE_APPS` - `['recorder', 'tour', 'osm']`, the `dist-site`
  folders checked.
- `assertNoSourceMapsDeployed({ siteDir, env? })`
  - Without `env.SENTRY_AUTH_TOKEN` (default `process.env`): returns at once.
    Nothing was uploaded or deleted, and the maps are wanted.
  - With it: throws when a `*.map` file is left at any depth under one of
    the folders, naming every such file relative to `siteDir`, or when one
    of the folders is missing (a check of nothing must not pass).

## Invariants & assumptions

- Only the apps that delete their maps are checked; the other apps' builds
  write no maps for the error service.
- The list is exactly the apps whose Vite config calls
  `sentrySourceMapPlugins`: `tests/repo-config/source-map-free-apps.test.js`
  derives that set from the configs and the site build's `--base` per
  package, and fails on any difference, and on a check that runs before one
  of those builds. An app built at the site root (`--base=/`, the Landing)
  has no folder to list, and the test says so if it adopts the helper: its
  maps would first need a root check here.

## Example

```js
assertNoSourceMapsDeployed({ siteDir: distSite });
```

## Tests

`scripts/source-maps-deploy.test.mjs` (the root vitest config's
`scripts/*.test.mjs`), on temp folders: green without maps and without the
token, red with a map at any depth in either app (both named) and with a
folder missing, and another app's maps left alone.
`tests/repo-config/build-site-wiring.test.js` and
`tests/repo-config/source-map-free-apps.test.js` pin that `build-site.mjs`
calls it after those builds.
