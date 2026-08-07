# `src/mesh/poi.ts`

## Purpose

POI markers as placement data (W12) — the first feature a user can point at in
the 3D view and be told about directly. Everything clickable before this was an
affordance cell, which is an abstraction over the data rather than an object in
it.

## Public API

- `PoiMarker` — `{ feature, position, groundHeightM, kind, label }`.
  `position` is ENU metres; `kind` is `key=value` of the primary tag; `label` is
  the `name` tag or the primary tag's value.
- `BuildPoiOptions` — `{ frame, groundHeightM? }`, the same shape as
  `BuildTreesOptions`.
- `buildPoiMarkers(features, options) → PoiMarker[]` — markers for every
  qualifying node, in input order. Never throws; unqualifying features are
  skipped.
- `isPoiNode(feature) → boolean` — whether this builder owns the feature.
- `poiKind(tags) → string | undefined` — the primary tag as `key=value`.

## Invariants & assumptions

- **No geometry is emitted, only placements.** Markers are numerous and identical
  up to a transform, so they are what `InstancedMesh` exists for, and stopping at
  placements keeps the package free of `three` (plan §4.2).
- **No per-type icons.** The testing notes asked to see _that_ something is there
  and be able to ask what it is; they did not ask for a playground pictogram. An
  icon set is a large amount of art plus a taxonomy decision, and can be added
  later behind this same placement type.
- **`POI_KEYS` order is load-bearing, not cosmetic.** A node can carry several at
  once (`amenity=cafe` + `tourism=information` is ordinary) and JS object key
  order is insertion order — so "the first key on the object" makes the answer
  depend on how the Overpass JSON happened to be written, and the same node could
  report different kinds on two runs.
- **Selection is on node-ness AND tags.** `amenity=parking` is overwhelmingly a
  way, and it is a ground plate (W11) or an area slab (W14). Selecting on the tag
  alone would put a marker in the middle of every car park in the tile.
- **`natural=tree` is excluded, because `trees.ts` owns it.** Drawn twice, a tree
  is a cone with a marker inside it — and the marker wins the pick, so the user
  clicks a tree and is told about a tree-shaped POI. This is the same
  who-owns-this-feature rule `plates.ts` enforces against buildings and roads.
- **Not every tagged node is a POI.** A `barrier=gate` or a routing node is not
  something a user points at, and marking everything would bury the ones that
  are. Values of `""` and `no` are treated as absent.
- **`groundHeightM` defaults to 0, never `NaN`.** `NaN` propagates into the
  instance transform and removes the object from the scene with nothing
  reported — the silent-absence failure this repo keeps meeting.
- **Order is deterministic** (input order). The demo compares runs across
  positions and devices, which an iteration-order-dependent list makes useless.

## Examples

```ts
const markers = buildPoiMarkers(features, {
  frame: enuFrameAt(userPosition),
  groundHeightM: (p) => field.heightAt(p),
});
// markers[0] === { feature: "node/4242", position: {x, y}, kind: "amenity=cafe", … }
```

## Tests

`poi.test.ts` — 14 tests:

- `isPoiNode` — accepts recognised keys; rejects unrecognised ones and untagged
  nodes; **rejects `natural=tree`**; **rejects a way carrying a POI tag**.
- `poiKind` — names the primary tag; picks deterministically when several apply
  (asserted by feeding the same tags in two key orders); `undefined` when none.
- `buildPoiMarkers` — ENU placement with the north sign checked; carries the
  feature key; label prefers `name` and falls back to the tag value; samples the
  ground; defaults ground to 0; skips non-qualifying features; deterministic
  order.
