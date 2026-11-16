# `scripts/source-maps-deploy.mjs` - no uploaded source map in the deploy

## Purpose

The Tour Viewer and the map demo upload their source maps to the error
service when `SENTRY_AUTH_TOKEN` is set, and delete them from their output
folders afterwards
(`GpsPlusSlamJs_AppFramework/scripts/sentry-vite-plugins.mjs`). The upload
plugin only logs a failed delete, so without this check such a build stays
green and deploys the maps. `scripts/build-site.mjs` calls it after both
apps are built.

## Public API

- `SOURCE_MAP_FREE_APPS` - `['tour', 'osm']`, the `dist-site` folders checked.
- `assertNoSourceMapsDeployed({ siteDir, env? })`
  - Without `env.SENTRY_AUTH_TOKEN` (default `process.env`): returns at once.
    Nothing was uploaded or deleted, and the maps are wanted.
  - With it: throws when a `*.map` file is left at any depth under one of
    the folders, naming every such file relative to `siteDir`, or when one
    of the folders is missing (a check of nothing must not pass).

## Invariants & assumptions

- Only the two apps that delete their maps are checked: the Recorder
  deploys its maps on purpose (`config/vite.config.ts`).
- A new app that uploads and deletes its maps belongs in
  `SOURCE_MAP_FREE_APPS`.

## Example

```js
assertNoSourceMapsDeployed({ siteDir: distSite });
```

## Tests

`scripts/source-maps-deploy.test.mjs` (the root vitest config's
`scripts/*.test.mjs`), on temp folders: green without maps and without the
token, red with a map at any depth in either app (both named) and with a
folder missing, and the Recorder's maps left alone.
`tests/repo-config/build-site-wiring.test.js` pins that `build-site.mjs`
calls it after both builds.
