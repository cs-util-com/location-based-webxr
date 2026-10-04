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

- `createStationPrefetch({ assets, read, budgetBytes? }): StationPrefetch`
  - `approach(station, distanceM, activateM)` - inside
    `activateM + PREFETCH_LEAD_M`, queue the station's assets;
  - `done(stationId)` - its media may be released first;
  - `load(path)` - the story's read: the cache, a read in flight, or a
    fresh read (not kept when it was never prefetched);
  - `heldBytes()`, `clear()`.
- `stationAssetIds(station)` - the asset ids a story reads, in step order,
  once each (figures and voices, pictures, sounds, video, models).
- `decodeDivisor(size?)` - the divisor that brings a figure within
  `MAX_DECODE_SIDE_PX` (1 when the size is not stated).
- `PREFETCH_LEAD_M` (80), the module-internal byte budget (64 MiB),
  `MAX_DECODE_SIDE_PX` (2048).

## Invariants & assumptions

- One prefetch read in flight, in the order stations were approached; a
  path is requested once per tour (the tour session reads one entry at a
  time anyway).
- The byte budget releases the station done longest ago first, never a
  station still offered; a read that does not fit is returned, not kept.
- A failed read is not kept and not marked requested: the story's own read
  tries again and says what failed.
- `clear()` bumps a generation: a read landing afterwards is not kept. The
  page clears at a session end and a tour close (the cache is keyed by entry
  path, which the next tour reuses).
- The decode cap: `visitor-stations.ts` runs figure decodes through one
  `keyed-chain` key (one at a time, the photo planes' rule) at
  `decodeDivisor(asset size)`. `decodeFrameTexture` decodes at full size and
  then resamples, so the peak is one full decode at a time; the GPU texture
  is at most 2048 px along its longer side (16 MB).

## Evidence (`station-prefetch.sweep.test.ts`)

- Lead 20-100 m x speed 0.8-1.8 m/s x story 1-20 MB x 1-20 Mbit/s, at the
  tightest and a typical station: at 80 m every story up to 5 MB is ready at
  1 Mbit/s and up to 20 MB from 5 Mbit/s; 60 m misses the 5 MB story at
  1.8 m/s on the tightest station, 40 m at 1.4 m/s.
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
  kept, a failed read not kept, the budget and its release order, `clear`.
- `station-prefetch.sweep.test.ts` - the lead and the decode cap.
