# `layer-toggles.ts`

## Purpose

The layer switches in the header, generated from the registry.

## Public API

- `attachLayerToggles({ container, onChange }): LayerToggles`
  - `render(layers)` — brings the switches in line with the store; safe on every
    change.
  - `dispose()` — removes the one delegated listener.

Each input gets `id="layer-<kind>"` and `data-layer`, so a test can address one
switch without depending on DOM order.

## Invariants & assumptions

- **The switches are GROUPED into affordance / world / debug (W15).** Nine of
  them in one wrapping row is the pile the round-3 notes called prototypical, and
  the grouping is not decoration: the three groups answer three different
  questions — what is the affordance analysis claiming, what is in the world, and
  what am I inspecting the renderer with.
- **THE IDS ARE THE CONTRACT.** Every switch keeps `#layer-<name>`; the e2e suite
  locates them that way, so the regrouping moved elements without renaming any.
- **`extras` puts a non-layer control in a group.** The perf panel is a
  diagnostic and belongs beside the height ramp, but it draws nothing in the
  scene so it is deliberately not in `ALL_LAYERS` (DEC-R3-18). Handing the
  element in beats a second registry or moving DOM after the fact.

- **Generated from `ALL_LAYERS`, never hand-written.** A hand-written row is a second
  list of layers, and the two drift the moment a builder is added — leaving a layer
  that renders but cannot be switched off, which is the exact state the registry
  exists to prevent. Generating them carries the compiler's exhaustiveness over
  `LayerKind` into the UI.
- **`onChange` reports a WHOLE set, not one changed layer.** The store's action
  replaces the set (see `osm-view-slice.ts` for the publish-boundary reason), and
  `toggleLayer` is the only thing that knows how to build a valid one. This file does
  DOM, not state arithmetic.
- **`render` only writes `checked` when it differs.** Re-rendering from the store must
  never be able to fire `change` and dispatch again — that is a feedback loop, and a
  subtle one to diagnose.
- **One delegated listener, held for `dispose()`.** Seven listeners would be seven
  things to remove, and an anonymous one cannot be removed at all.

## Examples

```ts
const toggles = attachLayerToggles({
  container: el("layers"),
  onChange: (next) => store.dispatch(actions.layersChanged(next)),
});
toggles.render(selectLayers(store.getState()));
```

## Tests

The pure decisions live in `layers.test.ts`. The wiring is covered by two e2e:
_"switch geometry off and on without refetching"_ (asserts through the status line's
own counters that the layer is not BUILT, and that no Overpass request is made — a
presentation change must not refetch) and _"switching the cells layer off clears the
grid in BOTH views"_ (the registry has to reach the map as well as the scene, or one
view keeps drawing what the store says is off).
