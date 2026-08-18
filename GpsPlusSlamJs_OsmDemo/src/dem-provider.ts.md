# `dem-provider.ts`

## Purpose

The demo's DEM composition, as one testable factory: **Mapterhorn primary, AWS
Terrarium fallback, both behind a single `createCachingTileFetch`** wired to
the same blob store the OSM tiles persist through.

## Public API

- `createDemProvider({ store, decodePng, fetchImpl? }):
FallbackElevationProvider` — the seam plus `fallbackProvider`'s live
  `stats` surface (`{ primaryAnswered, fallbackAnswered, unanswered }`,
  position counts accumulated for the provider's life). The worker snapshots
  it into every `TerrainResult.demStats`, and the AR readout renders the
  primary's share — so a field session can tell which DEM actually served.
  - `store` — an `OsmBlobStore`; the worker passes the **same** OPFS-backed
    store the OSM tiles and the rule table use. DEM entries are keyed by full
    request URL, so the three key families (`https://…`, `osm/v{n}/…`,
    `rules/v1/…`) coexist without a second store.
  - `decodePng` — `browserPngDecoder()` in the worker (it decodes WebP too —
    `createImageBitmap` sniffs bytes, the "Png" is historical); a synthetic
    decoder in tests, so no image codec runs in Node.
  - `fetchImpl` — the network, defaulting to global `fetch`. Injected so tests
    can count and script requests per host.
- `DEM_SOURCE_ID` — `"mapterhorn+terrarium"`, the composed provider's
  `sourceId`. The worker reports it with every terrain result
  (`TerrainResult.demSourceId`) and the AR readout renders it on the terrain
  line.
- `DEM_ATTRIBUTION` — the credit `main.ts` hands Leaflet's attribution control
  while terrain is on screen. Names **both** sources unconditionally, because
  the fallback can serve any tile the primary lacks.

## Invariants & assumptions

- **Precedence, not consensus.** Mapterhorn is strictly better wherever it has
  data (national LiDAR, Copernicus GLO-30 elsewhere), so the primary's answers
  survive untouched and the fallback fills only `undefined` gaps —
  `fallbackProvider`'s own header carries the two-source-median argument
  against blending.
- **One caching fetch for both providers.** Cache keys are full URLs, so the
  sources cannot collide; a cached tile survives a reload through the injected
  store (the offline-cold-start behaviour `caching-tile-fetch.ts` exists for).
- **Pure wiring.** No browser API is touched here; everything browser-bound
  (`navigator.storage`, `OffscreenCanvas`) stays in `demo-worker.ts`, which is
  exactly why this module can be unit-tested and the worker's `init` cannot.
- **Failure degrades per position.** A 404/outage on either host becomes
  `undefined` per post inside `TerrariumProvider`; a fallback failure never
  destroys the primary's answers (library-tested).

## Known gaps / follow-ups

- **`TerrariumProvider` hardcodes the AWS attribution and `sourceId`** whatever
  `urlTemplate` it is given, so the Mapterhorn instance mislabels itself and
  the composed provider's own `attribution` field reads as the AWS credit
  twice. The demo therefore displays the `DEM_ATTRIBUTION` constant and pins
  the composed id via `fallbackProvider`'s `sourceId` option. Library
  follow-up: accept `attribution?`/`sourceId?` in `TerrariumProviderOptions`,
  then derive `DEM_ATTRIBUTION` from the composed provider instead of a
  constant.
- **Per-sample source attribution is deliberately absent.** The
  `ElevationProvider` seam returns heights with no per-position provenance, so
  "which member answered THIS post" is unknowable here; what IS known is the
  aggregate — `stats` counts positions per source, and the HUD renders the
  primary's share beside the composed id. True per-sample provenance would be
  a library seam change — file it as such rather than approximating it in the
  demo.
- **A DEM source change means a mesh rebuild, never a live re-sample.** The
  building bases are baked into vertices against the field the worker held at
  mesh-build time, so any future runtime source switch (a settings toggle, a
  self-hosted mirror) must ride the existing terrain-gate/rebuild path —
  load the new field, bump the terrain stamp, rebuild — exactly as a position
  change does. Re-sampling the live field under standing geometry would leave
  the buildings on the old source's ground while every readout describes the
  new one: the divergence class `worker/terrain-gate.ts` exists to prevent.

## Examples

```ts
const provider = createDemProvider({
  store, // the worker's OPFS blob store
  decodePng: browserPngDecoder(),
});
const terrainField = createTerrainField({ provider });
```

## Tests

`dem-provider.test.ts` — primary-first (no AWS request while Mapterhorn
answers), fallback on a primary 404, a repeat query served from the injected
store with **zero** network fetches (a second provider instance models a
reload), the serving stats (primary-served against fell-back), and the
`DEM_SOURCE_ID`/`DEM_ATTRIBUTION` identities. No
property-based spec, deliberately: every behaviour is a composition of
already-property-tested library parts (`fallbackProvider`,
`TerrariumProvider`, `createCachingTileFetch`), and a property over the wiring
would re-test those parts through one fixed configuration.

The e2e side: `playwright-tests/fixtures.js` intercepts **both** DEM hosts
with the same synthetic tile (the provider's tile-size invariance is
library-tested, so a 2×2 PNG exercises the real path), and
`boot-and-shell.spec.js` asserts the attribution credits both sources.
