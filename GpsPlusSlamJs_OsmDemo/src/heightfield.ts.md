# `heightfield.ts`

**Purpose.** Fetch terrain elevation once for the area around the user and expose it as a synchronous relative-height sampler the mesh build can call per building.

## Public API

- `buildHeightfieldData(provider, { frame, extentM, spacingM, signal? }): Promise<HeightfieldData>` — **never rejects.** Plain, cloneable data; this is what the worker calls and what crosses the boundary.
- `heightfieldFrom(data): Heightfield` — rebuilds the synchronous sampler. The ONE place `heightAt` is created, so the worker and the main thread cannot disagree about what a post means.
- `createHeightfieldCache(): (data | undefined) => Heightfield | undefined` — a `heightfieldFrom` that rebuilds only when the data OBJECT changes. Identity, not contents: `HeightfieldData` is replaced wholesale on reload and never mutated, so identity answers "is this still the same terrain" exactly, and a deep compare would cost more than the rebuild it saves. Exists because the worker's per-vertex samplers called `heightfieldFrom` inside themselves, allocating a spread plus a closure per sampled vertex of the ~931-cell affordance grid (PR #239).
- `buildHeightfield(provider, options): Promise<Heightfield>` — the main-thread convenience form, exactly `heightfieldFrom(await buildHeightfieldData(...))`. **Never rejects.**
- `Heightfield` — `HeightfieldData` plus `heightAt({x, y})`, where `HeightfieldData` is `{ heights, side, extentM, datum, hasData, missing, total, reliefM, nearReliefM }`.
  - `heightAt` is **relative** to the frame origin and always finite.
  - `hasData: false` means flat zero everywhere.
  - `reliefM` is peak-to-trough across the field; `nearReliefM` is the same within `NEAR_FIELD_M` of the origin (DEC-R2-22 — over a 2.8 km field the whole-field number stops describing the ground the user is standing on).
- `TERRAIN_EXTENT_M = 1400` — half-width of the ground plane and of the terrain sampled under it, i.e. a 2.8 km square matching the geometry actually rendered. **Moved here from `building-view.ts` on 2026-07-31** because the worker also needs it (to clip ground plates before triangulating) and must not import three.
- `NEAR_FIELD_M = 300` — radius treated as "around the user" for `nearReliefM`. Always lived here; listed now because PR #237 pointed out neither constant was.
- `peakToTrough(values)` — a fold, never a spread into `Math.max`, which throws above ~100 k elements. Exported because `terrain-field.ts` needs exactly this and two copies is two chances for someone to "simplify" one back into a spread.

## Invariants & assumptions

- **The sampled surface IS the drawn surface (W10, finding R3-6).** `heightAt`
  interpolates over the SAME triangles `THREE.PlaneGeometry` draws — barycentric
  on the plane's own lattice and diagonal — not bilinearly over the posts.
  - **Why it had to change:** the two are different surfaces. The plane carries
    heights only at the posts and the GPU interpolates linearly across each
    triangle; a bilinear read is a hyperbolic paraboloid that agrees only at the
    posts. Between them they differ by the quad's twist term — decimetres in city
    DEM data against a 4 cm lift ladder — so plates, roads, slabs and cells sank
    UNDER the terrain wherever the ground twists. That was the reported bug, and
    no lift constant chosen this way could have fixed it.
  - **Two preconditions, both asserted rather than assumed** in
    `heightfield.plane.test.ts`: the plane's lattice is the field's lattice (it is,
    only while `MAX_GROUND_SEGMENTS` does not bind), and the DIAGONAL is three's.
    The diagonal is a property of a dependency and this file must stay three-free
    because the worker imports it, so the rule is necessarily restated here — and
    a three upgrade that flipped the winding would otherwise silently restore the
    error.
  - **The GPU path lands on the same surface for free**: it displaces the same
    posts and the rasteriser interpolates linearly across the same triangles.

- **It is pre-fetched, not lazy.** `buildBuildings` and `buildTrees` take a synchronous `groundHeightM(position) => number`, called per volume inside a mesh build, so all network work must finish first. That is the entire reason this is a grid rather than the provider passed straight through.
- **`undefined` is never `0`.** `elevationAt` returns `undefined` for "no data", and `?? 0` would turn a DEM outage into a sea-level hole shaped exactly like the outage — which reads as terrain rather than as a failure, and buries the buildings standing in it. Missing posts take the mean of the posts that did arrive; when _nothing_ arrives the field is flat and `hasData` is false.
- **The surface is RELATIVE, and the datum cancels.** The provider returns orthometric height (~53 m at Cologne) while the ENU frame puts the user at `y = 0`. The origin's sampled height is subtracted from every read. **A later AR mode needs the opposite** — absolute height against an ellipsoidal GNSS altitude, which is what the package's geoid model is for. Do not reuse this there.
- **`heightAt` is total, and the clamp is a guard rather than a working path.** Outside the extent it clamps to the edge rather than returning `NaN`: the ground plane and the affordance grid both sample it, and a `NaN` vertex silently drops a triangle instead of reporting anything. Pinned by a property test over arbitrary points.
  - **The clamp used to be justified by "the caller sizes the plane to the extent anyway", and that was false — it was the R2-9 bug.** True of the ground plane, false of the buildings, which reached ~2.8 km while the field was 600 m. Because `x` and `y` clamp _independently_, each outside building took the nearest edge's height at its own cross-axis offset, extruding the edge profile outward as stripes that read as terrain data. **DEC-R2-9 replaced the claim with a structural guarantee:** the field is sized from the extent actually being rendered, so reaching the clamp in production means that sizing is broken upstream.
- **Production no longer calls the builders in this file.** Since W7/W8 the demo samples through `terrain-field.ts`'s `sampleGrid`, which renders a bounded `HeightfieldData` out of the cached global lattice. `buildHeightfieldData`/`buildHeightfield` remain as the directly-testable reference for the same shape, and `heightfieldFrom` — the sampler both paths share — **is** on the production path, in the worker and on the main thread. Note the one divergence, tracked as F14's neighbour **F10**: this file reports `nearReliefM` as the whole-field number, while `sampleGrid` computes it separately as DEC-R2-22 requires.
- **Bilinear never overshoots the data.** It is a weighted average, but the datum subtraction and the missing-post fill both shift the numbers; a property test asserts no sample exceeds the real relief, because a sampler that invents a peak the DEM never had is one nobody can use to judge whether the terrain looks right.
- **One batched call for every post.** `elevationAt` is batch-in/batch-out precisely so a provider can coalesce by DEM tile; per-post calls would be thousands of requests for one view.
- **Sample at the source's resolution.** Terrarium z13 is ~12 m/px at Cologne, so the demo passes `spacingM: 12` — over `TERRAIN_EXTENT_M = 1400` (a 2.8 km square, ~55 k posts) since DEC-R2-8 widened it to the rendered extent. Finer interpolates invented detail at real network cost.
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
