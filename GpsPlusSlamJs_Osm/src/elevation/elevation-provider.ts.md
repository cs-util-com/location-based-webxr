# `elevation/elevation-provider.ts`

## Purpose

The elevation seam, plus two composition wrappers: multi-source consensus and
primary-with-fallback.

## Public API

- `interface ElevationProvider` — `attribution`, `sourceId`,
  `elevationAt(positions, signal?): Promise<readonly (number | undefined)[]>`.
- `class NullElevationProvider` — `undefined` everywhere.
- `consensusProvider(providers, { sourceId? }): ElevationProvider`
- `fallbackProvider(primary, fallback, { sourceId? }):
FallbackElevationProvider` — the fallback fills only the positions the
  primary returned `undefined` for, in one batched retry. Default `sourceId`
  is `` `${primary.sourceId}+${fallback.sourceId}` ``; attribution is both
  attributions joined with `" · "` (empty ones dropped).
- `FallbackElevationProvider` — the seam plus a live `stats` surface.
- `FallbackProviderStats` — `{ primaryAnswered, fallbackAnswered,
unanswered }`, counts of **positions** (not requests), accumulated over the
  provider's lifetime. This is the aggregate answer to "which DEM actually
  served this session" — the seam itself deliberately carries no per-sample
  provenance, so without these counters a silent everything-fell-back session
  is indistinguishable from one the high-resolution primary served.
- `median(values): number | undefined` — **no longer defined here.** It moved
  to [`../utils/median.ts`](../utils/median.ts.md) when the package's second
  copy (in `regions/region-builder.ts`) was folded in; this module imports it,
  and the `elevation/` barrel still re-exports it so consumers see no change.

## Invariants & assumptions

- **Batch in, batch out, same length and order.** A per-point API would make the
  raster provider's whole advantage inexpressible, and invites the C#
  reference's original mistake of five point queries per tile.
- **`undefined` means "no data", never `0`.** Zero is a real elevation, so a
  provider returning it on failure produces a plausible wrong answer. The C#
  reference's `NoElevationLookup` returns `1` rather than `0` — a workaround for
  a type that could not say "I don't know".
- **Orthometric metres.** The geoid conversion is `geoid.ts`'s job and is not
  applied here, so a caller always knows which datum it holds.
- **A provider never throws for missing data**; only aborts and programmer
  errors propagate.
- **Consensus takes the MEDIAN, not the mean.** DEM disagreement is a large
  systematic offset when one source is wrong about a region — the case a mean is
  worst at. Ported from the reference, which stores every sample from every
  provider per cell and reads back the median.
- A provider that rejects contributes nothing rather than failing the batch.
- **Fallback is precedence, not blending — use it when the sources are NOT
  peers.** A median of two samples degenerates to their average, so consensus
  over a high-resolution primary and a coarse global fallback throws the
  primary's resolution away wherever both answer. `fallbackProvider` keeps the
  primary's answers untouched, spends the fallback's quota only on true gaps
  (one batched call with just the missing positions, merged back at their
  original indices), and makes every seam attributable to a coverage boundary.
  A fallback failure degrades its gaps to `undefined` without touching primary
  answers; an abort from either stage propagates. The output length is pinned
  to the input even against a misbehaving primary that returns a short array.
- **Fallback stats count settled outcomes.** `primaryAnswered` is recorded
  once the primary settles (so a later abort in the fallback stage keeps the
  primary's serving on the record); a failed fallback's gaps count as
  `unanswered`; a fallback that returns `undefined` for a gap counts it as
  `unanswered`, matching what the merged output actually says.

## Examples

```ts
const elevation = consensusProvider([
  new TerrariumProvider({ decodePng: browserPngDecoder() }),
  new OpenTopoDataProvider(),
]);
const [h] = await elevation.elevationAt([{ lat: 50.94, lng: 6.95 }]);

// High-resolution source first, coarse global coverage for its gaps:
const layered = fallbackProvider(
  new TerrariumProvider({
    decodePng: browserPngDecoder(),
    urlTemplate: MAPTERHORN_URL_TEMPLATE,
  }),
  new TerrariumProvider({ decodePng: browserPngDecoder() }),
);
```

## Tests

`median` itself is pinned by [`../utils/median.test.ts`](../utils/median.ts.md),
where the implementation lives.

`elevation-provider.test.ts` — the null provider's `undefined`, consensus
rejecting an outlier, surviving a failing provider, ignoring non-finite samples,
deduplicated attribution, and `fallbackProvider`: primary answers all / none /
some, the fallback receiving ONLY the gaps in one batched call, in-order
merging, surviving a failing fallback, abort propagation from both stages,
signal pass-through, and the stats surface (all-primary, mixed batches,
accumulation across calls, a failing fallback's gaps counted as unanswered).
`elevation-provider.property.test.ts` — for arbitrary answer patterns,
`output[i] === primary[i] ?? fallback[i]` with the fallback queried exactly on
the gap set.
