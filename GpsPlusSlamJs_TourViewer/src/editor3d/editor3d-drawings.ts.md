# `editor3d-drawings.ts` - the item builders of both 3D views

## Purpose

The one list of builders the flat view (`editor3d-scene.ts`) and the globe
view (`editor3d-globe.ts`) hand the stations layer
(`editor3d-stations.ts`) to draw a station's items with. They are the
visitor's own builders, so the editor shows an item as the phone does.
Before this list each view wrote its own, and the globe's lacked the
reading sign: a long text shown as a sign was drawn in the flat view only.

## Public API

- `editorDrawings(loadContent)` - an `EditorDrawings`:
  - `makeLabel` - `createPinLabel` (`pin-label.ts`), a pin's label;
  - `makeLectern` - `mountLectern` (`lectern-view.ts`), a long text's
    reading stand;
  - `makeReadingSign` - `mountReadingSign` (`reading-sign.ts`), a long
    text's reading sign, with no opener (a click in the editor selects
    it);
  - `loadPhotoTexture(entry)` - the entry read through `loadContent` and
    decoded by `decodeFrameTexture`, measured against
    `TOUR_MAX_IMAGE_PIXELS` first, as the visitor's page does;
  - `loadContent(entry)` - forwarded to `loadContent`;
  - `loadGlbModel` - `glb-model.ts`;
  - `worldPart` - `worldPartOf` (`play-kinds.ts`), the visitor's world
    door: any other item's part by its kind's row, which the layer asks in
    the editor's mode (`worldEnv("edit", ...)`). There is no second
    preview path: the editor shows a door kind's part as the visitor's
    page builds it.
- `EditorDrawings` - those seven fields of `StationsLayerDeps`.

## Invariants & assumptions

- Both views spread the result into `createStationsLayer`'s deps; a
  builder the layer gains belongs here, never in one view.
- `EditorDrawings` is `Required<Pick<...>>`: the layer's deps are
  optional, so a plain `Pick` would let a listed builder go missing
  unnoticed; dropping one is a type error here. A builder newly added to
  the layer's deps and not listed here is caught by neither the type nor
  `editor3d-drawings.test.ts`, which pins the listed builders by name.
- A failed read rejects as `loadContent` does; the layer leaves that item
  out.

## Examples

```ts
const layer = createStationsLayer({
  parent: scene,
  ellipsoid,
  worldFromEcef,
  undulationAt,
  ...editorDrawings((entry) => deps.loadContent(entry)),
  makeBillboard,
  makeCodeSquare,
});
```

## Tests

`editor3d-drawings.test.ts`: every builder is the visitor's own, and a
photo and a content entry are read through the given loader. That the
layer builds a part from the same block, at the same pose, as the
visitor's page: `editor3d-stations.test.ts`.
