# tree-model.ts

## Purpose

The 3D view's tree as data, pure: an explorer row per station (number,
name, item count, lock, card picture, story folders and items), the
codes, and a chip per layer the view can show, drawn from the tour,
`editorView` and the tree's search alone. The DOM is `shell-tree.ts`'s.

## Public API

- `LAYER_LABELS` - the chips' words per `ShellLayer`.
- `TreeInput` - `{ stations, assets, codes: { id, title, meta }[], view,
layers, query? }`; `view` is the `editorView` state (its
  `unlockedStations` optional), `layers` the layers the view can draw
  (the others get no chip), `query` the tree's search, `searchFolded`
  the stations a search unfolded whose arrow folded them again (the
  shell's, cleared with each new search).
- `buildTree(input)` -> `TreeModel` `{ sections, stationCount, query,
cards, codes, chips }`:
  - `TreeCard` - `{ id, selection, number, title, imagePath | null,
open, searchOpened, count, unlocked, selected, context, folders,
children }`; `count` is how many items it holds, `unlocked` whether
    its position may be moved (every station starts locked), `context`
    is true for the card of a selected item; `children` are its free
    items (`TreeChild`), `folders` its story folders (`TreeFolder`
    `{ id, title, open, children }`), listed before them - always empty
    until the format has story folders;
  - the search (`query`, trimmed into `TreeModel.query`) matches as the
    2D rail's does (`../editor-model.ts` `matchesQuery`): a station
    whose name or description holds it is listed with all its items as
    its fold has them; else one with items whose title or kind's words
    hold it is listed with just those (`searchOpened`), unfolded
    unless `searchFolded` names it; else it is left out. The
    description is matched, not listed: it is the inspector's.
    The kind's words are the rail's for a pin and a photo ("note short
    text", "note picture"), "long text reading sign" and "3d model".
    Codes are listed when their title or line holds it.
    `stationCount` stays the tour's;
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
  tree shows, stations in list order (of a tree drawn without a search,
  which unfolds the stations whose items it finds).
- `stationGroups(stations)` -> the editor kit's `TreeGroup[]`: each
  station's id with its items' ids, for the tree's click rule
  (`treeClickPlan`).

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
unfolded id ignored, the explorer row's facts (count, unlocked, no
folders yet), the search (blank, by a station's name or description, by
an item's title or kind's words, codes, nothing found),
`stationImagePath`'s order, `stationGroups`.
`tree-model.property.test.ts`: for any station list and any run of fold
and select steps, the tree is drawn exactly as `editorView` holds it, a
fresh view given the drawn folds draws the same tree (the round trip),
and reordering the list keeps the same stations unfolded.
