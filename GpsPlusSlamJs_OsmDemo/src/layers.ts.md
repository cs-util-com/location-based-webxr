# `layers.ts`

## Purpose

Names every render layer, and holds the enabled set as plain, immutable data.

## Public API

- `ALL_LAYERS` — the ordered tuple; `LayerKind` is derived from it.
- `LayerSet` — `Readonly<Record<LayerKind, boolean>>`, exhaustive by construction.
- `DEFAULT_LAYERS` — `cells`, `buildings`, `trees`.
- `isLayerEnabled`, `toggleLayer` (returns a new set), `serialiseLayers`,
  `parseLayers`.

## Invariants & assumptions

- **This seam is the deliverable, not the builders (DEC-R2-12).** The feedback asked
  for modularity so a later AR mode can request buildings + POI markers and skip
  ground plates. Individual builders are each straightforward; the seam is what is
  expensive to retrofit, so it landed first and the two existing layers were migrated
  through it **before** any new one was written.
- **Independent toggles, not a two-state mode (DEC-R2-10).** A mode makes it
  impossible to view a merged area _over_ the cells that produced it — the first
  check anyone runs when a region looks wrong. One mechanism therefore covers both
  the layer question and the cells/areas question.
- **`DEFAULT_LAYERS` reproduces the picture the demo shipped with, and nothing
  more.** Not "everything available": the registry's own migration has to be
  verifiable, and that needs a default whose output matches the known-good baseline.
  A default that switched new layers on as they were written would leave no _before_
  to compare against.
- **A plain record, never a `Set`.** This lives in a Redux slice: a `Set` is rejected
  by RTK's serialisability scan and dropped by `structuredClone` — silently, in the
  clone's case, so it would break the worker boundary without an error.
- **Every set has every key.** `setOf` builds from `ALL_LAYERS`, not from its input,
  so `isLayerEnabled` can never return `undefined` for a layer someone forgot — which
  would read as "off" while being a different thing.
- **`parseLayers` treats its input as untrusted** (it is a candidate URL parameter):
  unknown names are discarded rather than added, or they would be keys nothing could
  switch off and `LayerSet`'s exhaustiveness would be a lie.
- **An empty string means NO layers, not the default.** "Show nothing" has to be
  expressible, or a user who switches everything off gets the default back on reload
  with no explanation.

## Examples

```ts
const next = toggleLayer(DEFAULT_LAYERS, "roads", true);
if (isLayerEnabled(next, "roads")) buildRoads(features);
```

## Tests

`layers.test.ts` — 8 examples: the union is pinned against `ALL_LAYERS`, the default
matches the shipped picture, a toggle disturbs nothing else, the set is immutable
(a mutation would update store state without a dispatch, so subscribers would never
fire), the serialised form round-trips, unknown names are ignored, and an empty
string is distinct from the default.
