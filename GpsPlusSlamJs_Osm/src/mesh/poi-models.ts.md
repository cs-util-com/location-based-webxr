# `mesh/poi-models.ts` — a model for each of the fifty most common POI kinds

## Purpose

One procedural low-polygon model per POI kind, for the fifty kinds the weighting
sheet says are most common worldwide.

**Twenty-nine of the fifty are PORTED, not hand-authored (DEC-R7b-2, round 8).**
The owner compared 51 candidate models from seven prototype files against the
shipped set and named a winner per kind; 29 winners were not the incumbent. Those
are built by `adopted()` from the surviving `poi-variants-*.ts` maps; the other
21 are built by `model()` from primitives inline. Both produce the same
`PoiModel`, and every registry-wide contract test runs over both without knowing
the difference.

## Public API

- `PoiModel` — `{ kind, colour, heightM, mesh }`.
- `POI_MODELS: ReadonlyMap<string, PoiModel>` — keyed on `key=value`, the same
  string `poiKind` returns.
- `poiModelFor(kind): PoiModel | undefined` — `undefined` for the long tail,
  which falls back to the generic pin.

### The two builders, and why a ported model declares a target height

- `model(kind, colour, build)` — geometry authored here at real-world scale.
  `heightM` falls out of the mesh.
- `adopted(kind, colour, variants, targetHeightM)` — geometry ported from a
  prototype. The prototypes are **dioramas**: every kind was drawn to one display
  envelope whatever the thing really is, so `D`'s `place_of_worship` is ~1.9 m
  where a church is 12 m. The shape is right and the scale is not, so the mesh is
  grounded and then scaled uniformly to `targetHeightM`.
  - **`heightM` is still derived**, from the built mesh. The target is declared;
    the height is measured. They agree by construction, and
    `poi-models.test.ts` asserts it for every model either way.
  - **The targets are measured values, not round numbers**, and that is
    deliberate: each is the height the winning variant already had, so the
    adoption is a fixed point rather than a resize.
  - **Two targets are 3× their shipped model** — `amenity=grave_yard` and
    `historic=yes`. Their shipped models are ground markings, and the owner
    asked for both to be "at least three times bigger". Scaling to the shipped
    height would silently undo that.

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
