# `scripts/globe-assets-deploy.mjs` - the globe's imagery on the deployed site

## Purpose

The Globe package's surface asks for its imagery by root-absolute paths
(`/globe-assets/...`, `GpsPlusSlamJs_Globe/src/globe-sources.ts`). The dev
servers answer them (the Tour Viewer's `src/dev-server/globe-assets-route.ts`,
the design system's `serve-routes.mjs`); the deployed site needs one copy at
its root, which the site build (`build-site.mjs`) makes with this module and
checks with its guard. One copy, shared by the Tour Viewer's editor on the
globe view and the look-dev labs (the full-globe editor plan 2026-10-27-1850
§3.3; the r1001 feedback plan 2026-11-01-0745, F7).

## Public API

- `GLOBE_ASSETS_PREFIX` - `"/globe-assets/"`.
- `copyGlobeAssets({ from, to })` -> `{ files, bytes }`: copies every file
  under `from` to the same relative path under `to`, except the Markdown
  notes (`README.md`, `PROVENANCE.md`: the repository's, not the site's).
  Error when `from` is missing or holds no file to copy.
- `chunksNaming(dir, needle)` -> the `.js`/`.mjs` files under `dir` whose
  text holds `needle`, relative to `dir` with `/`, sorted.
- `siteAppDirs(siteDir)` -> every folder directly under `siteDir` but
  `globe-assets`, absolute and sorted (`[]` for a missing site); the
  build scans these, so a new app is guarded without being named.
- `assertGlobeAssetsShipped({ siteDir, appDirs })` -> the chunks (under the
  `appDirs`) that name `/globe-assets/`; Error naming them when
  `<siteDir>/globe-assets/` is missing or holds no file. No chunk naming it:
  `[]`, whatever the folder.

## Invariants & assumptions

- Keyed on a REFERENCE: the guard fails only when something asks for the
  folder, so an app that drops the globe needs no change here.
- A missing or empty source fails the copy: an empty folder would pass a
  presence check and deploy the same 404s.
- Symbolic links are skipped (only regular files are listed).
- The visitor half (no visitor page's bundle names the folder) is not
  here: it needs the bundle's chunk graph, which the Tour Viewer's
  `src/app-bundle.test.ts` has.

## Examples

```js
const { files, bytes } = copyGlobeAssets({
  from: join(repoRoot, 'GpsPlusSlamJs_Globe', 'assets'),
  to: join(distSite, 'globe-assets'),
});
assertGlobeAssetsShipped({
  siteDir: distSite,
  appDirs: siteAppDirs(distSite),
});
```

## Tests

`scripts/globe-assets-deploy.test.mjs` (the root vitest config's
`scripts/*.test.mjs`): the app folders listed (every one but the
assets, an unnamed app's chunk caught), the copy without the notes and
its counts, the
refused sources, `chunksNaming`'s filter, and the guard red without the
folder and with it empty, green with it and with no chunk naming it.
`tests/repo-config/build-site-wiring.test.js` pins that `build-site.mjs`
calls both after the Tour Viewer's and the look-dev builds.
