# `dem-provider.ts`

## Purpose

The demo's DEM composition, as one testable factory: **Mapterhorn primary, AWS
Terrarium fallback, both behind a single `createCachingTileFetch`** wired to
the same blob store the OSM tiles persist through.

## Public API

- `createDemProvider({ store, decodePng, fetchImpl?, primaryTimeoutMs?,
fallbackTimeoutMs?, publishTimeoutMs?, onUpgrade? }): RacingElevationProvider` —
  the seam plus `racingProvider`'s `stats` surface. **The composition changed
  on 2026-08-19** from `fallbackProvider` to a race; see the section at the
  bottom for why, and `racing-provider.ts.md` for the seam itself.
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
    `PRIMARY_DEM_TIMEOUT_MS` (**30 s**) and `FALLBACK_DEM_TIMEOUT_MS` (8 s).
  - `publishTimeoutMs` — the bound on the whole composition, default
    `PUBLISH_DEADLINE_MS` (12 s). **This is the one that keeps the terrain gate
    from firing**, not the per-source deadlines.
  - `onUpgrade` — where Mapterhorn's late heights are delivered. Late binding is
    expected; the worker assigns it after building the terrain field.
- `PRIMARY_DEM_TIMEOUT_MS`, `FALLBACK_DEM_TIMEOUT_MS`, `PUBLISH_DEADLINE_MS` —
  exported so a test can assert the relationships between them and the terrain
  gate rather than restate the numbers.
- `PREFERRED_DEM_SOURCE_ID` (`"mapterhorn"`) / `FAST_DEM_SOURCE_ID`
  (`"aws-open-data"`) — what `stats.servedBy` reports. Named explicitly because
  both ends are `TerrariumProvider` instances differing only by URL.

- `DEM_SOURCE_ID` — `"mapterhorn+terrarium"`, the composed provider's
  `sourceId`. The worker reports it with every terrain result
  (`TerrainResult.demSourceId`) and the AR readout renders it on the terrain
  line.
- `DEM_ATTRIBUTION_ENTRIES` — the credits `main.ts` hands the map's attribution
  line while terrain is on screen. Names **both** sources unconditionally,
  because the fallback can serve any tile the primary lacks.
  - **Two entries, not one composed string** (round three, DEC-W1). Each carries
    a `short` name that stays permanently visible and a `full` sentence that
    lives behind the line's expander, so the two sources have to stay apart all
    the way to the DOM. The composed `DEM_ATTRIBUTION` constant that used to
    live here is gone — nothing rendered it once the line took entries, and an
    exported string with only a test for a reader is a dead export.

## Why the deadlines exist, and what each one bounds

**The failure they were introduced for (2026-08-19 session, §1 of the
twelfth-session feedback doc).** `fallbackProvider` asked the fallback only for
positions the primary returned `undefined` for. A primary that is **slow**
rather than broken produces no such positions — so the fallback was not
consulted at all, and a working source sat idle behind a stalled one. Measured
that day: the four z13 tiles one terrain window needs took **21.7 s** from
Mapterhorn and **1.04 s** from AWS, past the consumer's 15 s terrain gate, with
`cf-cache-status: HIT` on the slow responses. The owner reported it as "the
fallback is broken"; the fallback was fine and unreachable.

**The race replaced that composition, and the deadlines' jobs changed with it.**
Three numbers now, each bounding something different:

- **`FALLBACK_DEM_TIMEOUT_MS` (8 s)** — one AWS tile request. A last resort
  against a hang on the source the user actually waits for.
- **`PRIMARY_DEM_TIMEOUT_MS` (30 s)** — one Mapterhorn tile request. **Nobody
  waits for this**, so it is a pure anti-hang guard on a request whose only job
  is to arrive eventually as an upgrade. It was 3 s until the race landed;
  leaving it there would have shipped a race that can never be won, since every
  measured Mapterhorn tile exceeds 3 s.
- **`PUBLISH_DEADLINE_MS` (12 s)** — the whole composition, and **the only one
  that keeps the terrain gate from firing**.

**Why the third exists, which the first version of the race did not have.** The
per-source deadlines do not bound the composition. `racingProvider` waits for a
usable answer from EITHER arm and gives up only when BOTH are spent — so a fast
source that answers "no coverage" at 8 s leaves the batch waiting on the
preferred arm until its 30 s. Against a 15 s gate that re-creates the reported
bug exactly: the gate fires, the mesh is built flat, and there is no elevation.
The milestone review caught it; four texts had asserted the opposite, including
`lessons-learned.md`.

Expiring the publish deadline publishes an absence and **keeps the upgrade**, so
a merely-slow preferred source is not discarded, only deferred.

**The trap, if this is ever reimplemented:** a per-request deadline must surface
as a `TimeoutError`, not an `AbortError`. `TerrariumProvider.load` rethrows
aborts and degrades everything else, so an `AbortController`-based deadline
would reject the whole batch while looking like a fix. See `terrarium.ts.md`.

## The partly-answered window, and why the race is NOT its fix

**A window where some positions came back `undefined` is filled with the MEAN of
the ones that answered.** That was permanent until 2026-08-19: mean-filled posts
were written with the same `posts.set` as measured ones and then skipped by
`ensureAround`'s write-once guard forever, so a tile that failed while its
neighbours succeeded left thousands of posts holding a plausible, wrong height
for the life of the page.

**It is fixed, but not by `replacePosts`**, and the distinction matters because
the plan claimed otherwise until its cold review. Mean-fill requires **both**
sources to fail for a tile — and when both fail there is no better answer to
upgrade from, so no upgrade ever revisits those posts. `terrain-field.ts` now
tracks invented posts explicitly and re-requests them on a later pass, which is
the only shape that reaches them.

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

- **`TerrariumProvider` still hardcodes the AWS attribution** whatever
  `urlTemplate` it is given, so the composed provider's own `attribution` field
  reads as the AWS credit twice and the demo displays its own
  constants instead. **The `sourceId` half of this was fixed on 2026-08-19** —
  `TerrariumProviderOptions` now accepts one, which the race needed so
  `stats.servedBy` could tell the two instances apart. The attribution half
  remains: accept `attribution?` too, then derive `DEM_ATTRIBUTION_ENTRIES`
  from the composed provider rather than from constants. Note the follow-up got
  slightly harder in round three and slightly more worthwhile: the demo now
  needs a SHORT name per source as well as the full credit, which a library
  `attribution` string would not supply — so the honest library shape is a
  credit object rather than a string.
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
`DEM_SOURCE_ID`/`DEM_ATTRIBUTION_ENTRIES` identities.

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

## The DEM race (2026-08-19) — what replaced the fallback

`createDemProvider` now returns a **`racingProvider`**, not a
`fallbackProvider`. Both sources are asked at once, whichever answers first is
published, and Mapterhorn's heights replace AWS's in place when they land.

**Why the composition changed.** `fallbackProvider` consults the fallback only
for positions the primary returned `undefined` for. A merely SLOW primary
therefore leaves no gap, so the fallback was unreachable rather than broken —
which is what the twelfth testing session saw as "15 s of waiting and then no
elevation at all".

**Why the deadlines inverted.** Round one bounded the primary at 3 s, which made
the fallback reachable and fixed the stall. It also made the primary unwinnable:
Mapterhorn measured 3.0–21.7 s per tile from the reporting machine, so the LiDAR
heights were never served. Under the race nothing waits for the primary, so its
deadline stopped being a latency control and became a pure anti-hang guard —
hence **30 s**, above the measured worst case. The FAST source's 8 s deadline is
now the whole guarantee that something is published before the terrain gate's
15 s fires.

- Keeping the primary at 3 s would ship a race that can never be won.
- `dem-provider.test.ts` asserts the new relationships, and its comment records
  the old ones so the inversion is not mistaken for drift.

**The two ends are named.** Both are `TerrariumProvider` instances differing
only by `urlTemplate`, and both reported `sourceId: "terrarium"` until this
change — which made `stats.servedBy` unable to say which DEM the field came
from, the one thing it exists for. `PREFERRED_DEM_SOURCE_ID` and
`FAST_DEM_SOURCE_ID` fix that. `DEM_SOURCE_ID` still names the composition.

**Stats are a different shape now**, deliberately. See
`racing-provider.ts.md` — the old primary-vs-fallback ratio becomes
arithmetically undefined when both sources answer every position.

### Known hazard, now fixed rather than filed

The partly-answered window that got mean-filled permanently is fixed in
`terrain-field.ts`: invented posts are tracked and re-requested on a later
pass, and their count is carried on `TerrainResult.meanFilledPosts` — reported
across the worker boundary, **not yet shown to anyone**, which is a filed
decision rather than an omission: the twelfth testing session asked for less
diagnostic text, not more. It is **not** fixed by `replacePosts` —
mean-fill requires both sources to fail, which is exactly when there is no
better answer to upgrade to.
