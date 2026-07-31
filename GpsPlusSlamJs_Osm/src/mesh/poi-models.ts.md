# `mesh/poi-models.ts` — a model for each of the fifty most common POI kinds

## Purpose

One procedural low-polygon model per POI kind, for the fifty kinds the weighting
sheet says are most common worldwide.

## Public API

- `PoiModel` — `{ kind, colour, heightM, mesh }`.
- `POI_MODELS: ReadonlyMap<string, PoiModel>` — keyed on `key=value`, the same
  string `poiKind` returns.
- `poiModelFor(kind): PoiModel | undefined` — `undefined` for the long tail,
  which falls back to the generic pin.

## Invariants & assumptions

- **Fifty, chosen by data rather than taste** (DEC-R4-7). The ranking is
  `poi-ranking.ts` and a test asserts the registry still equals it — a ranked
  kind with no model is a marker that silently falls back to a cone, and a model
  outside the fifty is work spent on something the data says is rare.
- **Each model is its own composition, not a shared shape at a different size.**
  The shape-family option was explicitly rejected; a picnic table is a slab with
  a bench each side, a bench is not.
- **`heightM` is DERIVED from the built mesh, never declared.** Twenty-five of
  the fifty disagreed with a hand-written figure on the first run — an awning two
  centimetres above a roof, a spire counted twice — and every one of those was a
  second source of truth for how tall the thing is.
- **Real-world dimensions are the point.** `POI_HEIGHT_M = 6` used to apply to
  every marker, so a bench and a hospital entrance were the same 6 m cone. Scale
  is most of what makes a bench read as a bench.
- **The palette is muted material colours** — timber, steel, paint, stone, water,
  greenery — not category codes. The affordance heat ramp owns the loud end and
  must stay the loudest thing on screen (R4-14 warns the scene is already close
  to too colourful).
- **Keys must be `poiKind`-shaped**, or every lookup misses while both sides look
  correct in isolation. Asserted.
- **Accepted risk (DEC-R4-14):** the models are judged in the demo scene, with no
  contact sheet. A kind that appears at none of the six fixture sites ships
  without ever having been looked at, and relative-scale errors are much harder
  to see in a city than on a neutral row.

## Examples

```ts
const model = poiModelFor(poiKind(feature.tags) ?? "");
if (model !== undefined) {
  // one InstancedMesh per kind; instances differ only by translation
}
```

## Tests

`poi-models.test.ts` — the contract, applied by iterating the registry so a new
model cannot be added without satisfying it: registry equals the ranking, only
eligible keys, `poiKind`-shaped keys, non-empty geometry, no NaN, base on the
ground, derived height matches, plausible size, a triangle ceiling, lookup hit
and miss, and the two kinds the feedback named by hand.
