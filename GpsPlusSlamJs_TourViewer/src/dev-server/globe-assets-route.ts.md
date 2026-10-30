# globe-assets-route.ts

## Purpose

The Tour Viewer's dev server route `/globe-assets/` (the e2e runs on the
same server): it serves the Globe package's committed `assets/` folder,
which the globe's surface asks for by these absolute paths. Only the editor
on the globe view (`../editor3d/editor3d-globe.ts`, behind `globe=1`) loads
them. The build does not copy them, so the deployed site has no such route.

## Public API

- `GLOBE_ASSETS_PREFIX`: `"/globe-assets/"`.
- `globeAssetFile(url, dir)`: the file under `dir` the URL names, or null
  for a URL outside the prefix, the bare prefix, a path that cannot be
  decoded, one holding a NUL, or one that leaves `dir` (plain or
  percent-encoded `..`). The query is ignored.
- `serveGlobeAsset(req, res, dir, next)`: `next()` outside the prefix; 403
  for a refused path; 404 for a file that is not there; 200 with the file
  and a content type by extension (webp, png, jpg, json, md; otherwise
  `application/octet-stream`).
- `globeAssetsRoute(dir)`: the route as a Vite plugin (`configureServer`
  only), used by `../../vite.config.ts`.

## Invariants & assumptions

- Never serves outside `dir`: the path is resolved and checked against it.
- Files are read whole (the tiles are about 6 KB each).
- Dev and e2e only; a deploy of the globe view needs its own decision about
  the about 13 MB of assets.

## Example

```ts
plugins: [
  globeAssetsRoute(
    fileURLToPath(new URL("../GpsPlusSlamJs_Globe/assets", import.meta.url)),
  ),
];
```

## Tests

`globe-assets-route.test.ts`: a file served with its type, a missing file
404, traversal (plain and encoded) refused, a URL outside the prefix passed
on, the query ignored.
