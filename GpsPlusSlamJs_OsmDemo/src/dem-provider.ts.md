# `dem-provider.ts`

## Purpose

The demo's DEM composition, as one testable factory: **Mapterhorn primary, AWS
Terrarium fallback, both behind a single `createCachingTileFetch`** wired to
the same blob store the OSM tiles persist through.

## Public API

- `createDemProvider({ store, decodePng, fetchImpl?, primaryTimeoutMs?,
fallbackTimeoutMs? }): FallbackElevationProvider` — the seam plus
  `fallbackProvider`'s live
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
  - `primaryTimeoutMs` / `fallbackTimeoutMs` — per-tile deadlines, defaulting to
    `PRIMARY_DEM_TIMEOUT_MS` (3 s) and `FALLBACK_DEM_TIMEOUT_MS` (8 s). Tests
    pass a few milliseconds.
- `PRIMARY_DEM_TIMEOUT_MS`, `FALLBACK_DEM_TIMEOUT_MS` — exported so a test can
  assert the relationship between them rather than restate the numbers.

- `DEM_SOURCE_ID` — `"mapterhorn+terrarium"`, the composed provider's
  `sourceId`. The worker reports it with every terrain result
  (`TerrainResult.demSourceId`) and the AR readout renders it on the terrain
  line.
- `DEM_ATTRIBUTION` — the credit `main.ts` hands Leaflet's attribution control
  while terrain is on screen. Names **both** sources unconditionally, because
  the fallback can serve any tile the primary lacks.

## Why the deadlines exist, and why BOTH sources have one

**The failure they remove (2026-08-19 session, §1 of the twelfth-session
feedback doc).** `fallbackProvider` asks the fallback only for positions the
primary returned `undefined` for. A primary that is **slow** rather than broken
produces no such positions — so the fallback is not consulted at all, and a
working source sits idle behind a stalled one. Measured that day: the four z13
tiles one terrain window needs took **21.7 s** from Mapterhorn and **1.04 s**
from AWS, past the consumer's 15 s terrain gate, with `cf-cache-status: HIT` on
the slow responses (so not a cold origin that would warm up). The owner reported
it as "the fallback is broken"; the fallback was fine and unreachable.

**Why the fallback is bounded too, which the plan did not ask for.** Specifying
the deadline as primary-only would leave the identical hang one provider to the
right. AWS measured fast and has no documented rate limit — which is exactly
what was true of the primary before it wasn't. A deadline whose purpose is that
no single source can stall the composition has to cover every source in it. The
values differ because the roles do: the primary's is a switch to something
better, the fallback's is a last resort against a hang.

**The budget, stated as arithmetic rather than as reassurance.**
`fallbackProvider` is strictly serial — it awaits the primary, then the fallback
— so the worst case is 3 + 8 = **11 s of the gate's 15 s**. That is a 27 %
margin, not "well inside" (which is what this paragraph claimed before review),
and the remaining 4 s has to cover the OPFS reads, four WebP decodes, base64 of
~1 MB and the geoid pass, none of which these deadlines bound.
`dem-provider.test.ts` asserts the sum against `TERRAIN_WAIT_TIMEOUT_MS`, so
raising either value has to confront that margin rather than erode it silently.

**What the primary's deadline costs on the connection it was measured from.**
Every measured Mapterhorn tile exceeded 3 s, so on that link the primary always
loses: ~3 s of dead time and ~0.5–0.75 MB of abandoned download per new window,
repeated per window because a timed-out tile is never stored and never
remembered as slow. That is accepted deliberately — a coarse answer in ~4 s
beats an accurate one at 15 s — and the thing that removes the trade is the
race (DEC-T2 / M3), not a larger constant. See `dem-provider.ts`.

## Known hazard the deadlines make more reachable

**A partly-answered window is filled with the MEAN of the tiles that did
answer, permanently.** `terrain-field.ts`'s `ensureAround` writes each post
once (`if (posts.has(key)) continue`) and substitutes the mean of the known
heights for any post that came back `undefined`, so a tile that fails while its
neighbours succeed leaves thousands of posts holding a plausible, wrong,
un-revisitable height.

This is **pre-existing**, not introduced here: a 404 on both sources always did
it. What the deadlines change is how reachable it is, and they narrow it in one
direction while widening it in another — a primary timeout normally produces no
gap at all, because the fallback fills exactly those positions, so this needs
_both_ sources to fail for the same tile.

Not fixed here because the honest fix is a design decision (all-or-nothing per
window, or a revisitable lattice — the latter is M3's `replacePosts` work), and
because M3 may not be built. Filed as a follow-up rather than left implicit:
see the twelfth-session follow-up doc. **Do not** cite M3 as its mitigation
without checking M3 shipped.

**The trap, if this is ever reimplemented:** the deadline must surface as a
`TimeoutError`, not an `AbortError`. `TerrariumProvider.load` rethrows aborts
and degrades everything else, so an `AbortController`-based deadline would
reject the whole batch and reinstate the unreachable-fallback bug while looking
like its fix. See `terrarium.ts.md`.

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
`DEM_SOURCE_ID`/`DEM_ATTRIBUTION` identities.

Two cases carry the deadline and are the ones to keep if anything here is ever
trimmed:

- _"lets the fallback serve when the primary is SLOW rather than failing"_ — the
  assertion whose absence let the 2026-08-19 regression ship. It has to live at
  THIS seam: against `fallbackProvider` directly a never-settling fake primary
  hangs forever, because that combinator carries no deadline of its own.
- _"degrades on a DEADLINE but still propagates a caller's ABORT"_ — the two
  halves together, because it is the difference between them that matters.

No
property-based spec, deliberately: every behaviour is a composition of
already-property-tested library parts (`fallbackProvider`,
`TerrariumProvider`, `createCachingTileFetch`), and a property over the wiring
would re-test those parts through one fixed configuration.

The e2e side: `playwright-tests/fixtures.js` intercepts **both** DEM hosts
with the same synthetic tile (the provider's tile-size invariance is
library-tested, so a 2×2 PNG exercises the real path), and
`boot-and-shell.spec.js` asserts the attribution credits both sources.
