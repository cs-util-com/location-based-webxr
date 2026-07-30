# `heightfield.ts`

**Purpose.** Fetch terrain elevation once for the area around the user and expose it as a synchronous relative-height sampler the mesh build can call per building.

## Public API

- `buildHeightfieldData(provider, { frame, extentM, spacingM, signal? }): Promise<HeightfieldData>` — **never rejects.** Plain, cloneable data; this is what the worker calls and what crosses the boundary.
- `heightfieldFrom(data): Heightfield` — rebuilds the synchronous sampler. The ONE place `heightAt` is created, so the worker and the main thread cannot disagree about what a post means.
- `buildHeightfield(provider, options): Promise<Heightfield>` — the main-thread convenience form, exactly `heightfieldFrom(await buildHeightfieldData(...))`. **Never rejects.**
- `Heightfield` — `{ heightAt({x, y}), hasData, missing, total, reliefM }`.
  - `heightAt` is **relative** to the frame origin and always finite.
  - `hasData: false` means flat zero everywhere.
  - `reliefM` is peak-to-trough across the field.

## Invariants & assumptions

- **It is pre-fetched, not lazy.** `buildBuildings` and `buildTrees` take a synchronous `groundHeightM(position) => number`, called per volume inside a mesh build, so all network work must finish first. That is the entire reason this is a grid rather than the provider passed straight through.
- **`undefined` is never `0`.** `elevationAt` returns `undefined` for "no data", and `?? 0` would turn a DEM outage into a sea-level hole shaped exactly like the outage — which reads as terrain rather than as a failure, and buries the buildings standing in it. Missing posts take the mean of the posts that did arrive; when _nothing_ arrives the field is flat and `hasData` is false.
- **The surface is RELATIVE, and the datum cancels.** The provider returns orthometric height (~53 m at Cologne) while the ENU frame puts the user at `y = 0`. The origin's sampled height is subtracted from every read. **A later AR mode needs the opposite** — absolute height against an ellipsoidal GNSS altitude, which is what the package's geoid model is for. Do not reuse this there.
- **`heightAt` is total.** Outside the extent it clamps to the edge rather than returning `NaN`: the ground plane and the affordance grid both sample it, and a `NaN` vertex silently drops a triangle instead of reporting anything. Pinned by a property test over arbitrary points.
- **Bilinear never overshoots the data.** It is a weighted average, but the datum subtraction and the missing-post fill both shift the numbers; a property test asserts no sample exceeds the real relief, because a sampler that invents a peak the DEM never had is one nobody can use to judge whether the terrain looks right.
- **One batched call for every post.** `elevationAt` is batch-in/batch-out precisely so a provider can coalesce by DEM tile; per-post calls would be thousands of requests for one view.
- **Sample at the source's resolution.** Terrarium z13 is ~12 m/px at Cologne, so the demo passes `spacingM: 12` over a 600 m extent (~2600 posts). Finer interpolates invented detail at real network cost.
- **`reliefM` exists because flat terrain and absent terrain render identically.** Only a number distinguishes them, and the status line says it out loud.

## Examples

```ts
const field = await buildHeightfield(
  new TerrariumProvider({ decodePng: browserPngDecoder() }),
  { frame: enuFrameAt(centre), extentM: 300, spacingM: 12 },
);
if (field.hasData) {
  buildingView.setTerrain(field);
  buildBuildings(features, {
    frame,
    groundHeightM: (p) => field.heightAt(frame.toEnu(p)),
  });
}
```

## Tests

- `heightfield.test.ts` — zero at the origin whatever the absolute elevation; a known slope reproduced; interpolation rather than stepping; clamping outside the extent; the all-missing flat fallback; no sea-level pit from scattered holes; the relief report distinguishing flat-loaded from not-loaded; one batched call; sampling at source resolution; degrading to flat when the provider rejects; and the abort signal passed through.
- `heightfield.property.test.ts` — over arbitrary terrain and arbitrary points: always finite, never exceeding the data's range, always exactly zero at the origin, and a missing count that never exceeds the total.
- `playwright-tests/osm-demo.spec.js` — _"stands the buildings on real terrain, and credits where it came from"_, against a **real** 2×2 Terrarium PNG generated in `fixtures.js`, so fetch, decode, sample and displace all run for real. An aborted tile would have exercised only the unavailable branch.
