# tree-model.ts

## Purpose

The 3D view's tree as data, pure: a story card per station (number,
name, description, card picture, items), the codes, and a chip per layer
the view can show, drawn from the tour and `editorView` alone. The DOM is
`shell-tree.ts`'s.

## Public API

- `LAYER_LABELS` - the chips' words per `ShellLayer`.
- `TreeInput` - `{ stations, assets, codes: { id, title, meta }[], view,
layers }`; `view` is the `editorView` state, `layers` the layers the
  view can draw (the others get no chip).
- `buildTree(input)` -> `TreeModel` `{ sections, stationCount, cards,
codes, chips }`:
  - `TreeCard` - `{ id, selection, number, title, description | null,
imagePath | null, open, selected, context, children }`; `context` is
    true for the card of a selected item; `children` are its items
    (`TreeChild`);
  - an item's title: `../../object-describe.ts`'s `objectTitle`, the one
    naming rule of every page (a pin's caption, a picture's title, else
    its caption, a model's title), else its kind's word
    (`BLOCK_KIND_LABEL`: "Photo", "3D model");
  - `TreeCode` - a code's row; `TreeChip` - `{ layer, label, on }`, on
    unless hidden.
- `stationImagePath(station, assets)` - the card picture's asset path: a
  photo of the station named as its picture, else a named image asset,
  else its first photo, else null.
- `treeFoldOf(tree)` -> `{ openStations, openSections }`: the folds the
  tree shows, stations in list order.

## Invariants & assumptions

- The fold state is `editorView`'s (`openStations`, `openSections`); an
  unfolded id the tour no longer has is ignored, so a removed station
  leaves no trace in the tree.
- Pure; no picture is read here (the shell reads the asset).

## Examples

```ts
const tree = buildTree({
  stations: manifest.stations,
  assets,
  codes,
  view,
  layers: ["codes", "names"],
});
```

## Tests

`tree-model.test.ts`: cards numbered and folded with their items as
text, the selected and context cards, the chips, the sections, a stale
unfolded id ignored, `stationImagePath`'s order.
`tree-model.property.test.ts`: for any station list and any run of fold
and select steps, the tree is drawn exactly as `editorView` holds it, a
fresh view given the drawn folds draws the same tree (the round trip),
and reordering the list keeps the same stations unfolded.
