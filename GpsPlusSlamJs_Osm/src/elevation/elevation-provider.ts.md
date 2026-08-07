# `elevation/elevation-provider.ts`

## Purpose

The elevation seam, plus the multi-source consensus wrapper.

## Public API

- `interface ElevationProvider` — `attribution`, `sourceId`,
  `elevationAt(positions, signal?): Promise<readonly (number | undefined)[]>`.
- `class NullElevationProvider` — `undefined` everywhere.
- `consensusProvider(providers, { sourceId? }): ElevationProvider`
- `median(values): number | undefined`

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

## Examples

```ts
const elevation = consensusProvider([
  new TerrariumProvider({ decodePng: browserPngDecoder() }),
  new OpenTopoDataProvider(),
]);
const [h] = await elevation.elevationAt([{ lat: 50.94, lng: 6.95 }]);
```

## Tests

`elevation-provider.test.ts` — the null provider's `undefined`, median
behaviour including order-independence and the empty case, consensus rejecting
an outlier, surviving a failing provider, ignoring non-finite samples, and
deduplicated attribution.
