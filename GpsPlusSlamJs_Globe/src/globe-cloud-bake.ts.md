# globe-cloud-bake.ts

Purpose: bakes the near clouds' noise tiles and the two numbers measured on them. No DOM and no three.js, so it runs in a worker.

## Public API

- `bakeCloudTextures(): CloudBakes`: the tiles `shape` (Perlin-Worley), `detail` (Worley erosion), `domes` (three generations of cumulus domes), `region` (the slow regional field), `blue` (blue noise), plus `lifeGain` and `detailMean`. Plain typed arrays, transferable.
- `CLOUD_BAKE_SIZES`: the size of each tile, the one place the march pass reads them from.
- `cloudLifeGain(domes, S)`: the gain that keeps the mean dome mass over the life cycle.
- `cloudDetailMean(detail)`: the mean the erosion is centred on.

## Invariants

- Deterministic: seeded, so a reload draws the same weather and a test can pin it.
- About a second of work: never on the main thread (`globe-cloud-bake-worker-core.ts`). The arrays are handed over without a copy.
- Tile sizes are powers of two, read with wrap: the march relies on it.

## Example

```ts
const bakes = bakeCloudTextures();
march.setBakes(bakes);
```

## Tests

`globe-cloud-bake.test.ts`: sizes, determinism, the tiles' ranges and means, wrapping at the edges.
