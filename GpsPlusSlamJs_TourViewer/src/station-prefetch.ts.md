# station-prefetch.ts

## Purpose

Prefetch on approach with a decode cap (tour kit plan K4, §8 P2): a
station's media are read from the tour while the visitor walks up to it, so
its story starts without "Loading…", and figures are decoded one at a time
and scaled to a bounded size. DEC-F4 ("find the consumer first, then
adopt") found its consumer here: the station run measures, every tick, how
far the visitor is from each offered station. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `createStationPrefetch({ assets, read, tour, budgetBytes?, leadM? }): StationPrefetch`
  (`leadM` only for the sweep)
  (`tour()` - the open tour, by identity: a different value or null drops
  the cache)
  - `approach(station, distanceM, activateM)` - inside
    `activateM + PREFETCH_LEAD_M`, queue the station's assets;
  - `ahead(station)` - the station that comes next in a fixed or branch
    order, while the current story plays: queue its assets from any
    distance (K4 review R5; the guide's `onUpcoming`);
  - `done(stationId)` - the media only done stations need may be
    released;
  - `load(path)` - the story's read: the cache, a read in flight, or a
    fresh read (kept only while a station asked for it);
  - `heldBytes()`; `sync()` - drop everything now if the tour changed or
    closed (every other call checks too).
- `stationAssetIds(station)` - the asset ids a story reads, in step order,
  once each (figures and voices, pictures, sounds, models; never a video,
  K4 review R3).
- `decodeDivisor(size?)` - the divisor that brings a figure within
  `MAX_DECODE_SIDE_PX` (1 when the size is not stated).
- `PREFETCH_LEAD_M` (80), the module-internal byte budget (64 MiB),
  `MAX_DECODE_SIDE_PX` (2048).

## Invariants & assumptions

- One prefetch read in flight, in the order asked; a path is read once at
  a time (the tour session reads one entry at a time anyway).
- **Held per asset (R11):** an asset is held for every station that asked
  for it; the budget releases only assets whose stations are all done, the
  one whose last station was done longest ago first. A released asset is
  read again when a later station asks.
- **Given up, not retried (R4):** a read that failed, or did not fit the
  budget, is not kept and not asked again for the stations that asked;
  another station asking tries once more; the story's own read always
  tries and says what failed. Without this, the guide's per-frame ticks
  re-read a failing entry every camera frame offline.
- **Lives with the tour (R15):** a change of `tour()` (another tour, or
  null at a close) bumps a generation and drops everything: a read landing
  afterwards is not kept. A session end keeps the cache; the page calls
  `sync()` when it stops the stations, so a close frees it at once (the
  cache is keyed by entry path, which the next tour reuses).
- The decode cap: `visitor-stations.ts` runs figure decodes through one
  `keyed-chain` key (one at a time, the photo planes' rule) at
  `decodeDivisor(asset size)`. `decodeFrameTexture` decodes at full size and
  then resamples, so the peak is one full decode at a time; the GPU texture
  is at most 2048 px along its longer side (16 MB).

## Evidence (`station-prefetch.sweep.test.ts`)

The real module on a virtual clock (1 s steps; a story is three equal
assets; a read takes 1 s plus its bytes at the link's rate, one at a time):

- **Approach** (the first station, or the next after a skip): lead 20-100 m
  x 0.8 / 1.4 / 1.8 m/s x 1 / 5 / 20 Mbit/s, the tightest station at 3 m
  accuracy and a typical one. At 80 m at least 5 MB is ready in every cell
  at 1 Mbit/s and 25 MB at 5 Mbit/s (worst: the tightest station at
  1.8 m/s); 60 m leaves 3.75 MB there, 40 m 2 MB. A longer lead never
  leaves a story less ready (asserted through the module, K4 review R17).
- **Castle spacing** (K4 review R5): stations 30 m apart in a fixed order.
  The K4 build had only 1-3 MB ready at 1 Mbit/s (1.75 MB at 1.4 m/s),
  whatever the lead - the next station is offered 30 m away - so its
  claim of "5 MB ready" did not hold at castle spacing. Reading the next
  station ahead while the current story plays adds that time: 4.5-6.75 MB
  after a 30 s story, 8-10.25 MB after 60 s, 15.25-17.5 MB after 120 s
  (23 MB and more at 5 Mbit/s after 30 s). A 0 s story gains nothing;
  reading ahead is never worse. Reversed by stories shorter than about
  30 s on a 1 Mbit/s link, where only the walk counts.
- A 1.7 m figure covers about 1840 px of a 2400 px screen from 2 m (60
  degree view): 2048 keeps it sharp from 2 m on; 1024 would look soft
  closer than about 3.7 m.

## Examples

```ts
const prefetch = createStationPrefetch({
  assets,
  read: session.loadContentEntry,
});
prefetch.approach(station, distanceM, bands.activateM);
const blob = await prefetch.load(asset.path); // a hit when it was prefetched
```

## Tests

- `station-prefetch.test.ts` - the asset list, the decode divisor, the
  radius, one read at a time, joining and hitting, a story-only read not
  kept, a failed read not kept, never a video (R3), offline not retried for
  the same station (R4), a shared asset held until both stations are done
  (R11), kept across a session end and dropped at a tour close (R15), the
  budget and its release order, a full budget not re-read, a tour change.
- `station-prefetch.property.test.ts` - random approaches, dones, answers
  and failures: in budget, one read per path at a time, no retry for a
  station a read failed for.
- `station-prefetch.sweep.test.ts` - the lead and the castle-spacing
  simulations through the module, and the decode cap.
