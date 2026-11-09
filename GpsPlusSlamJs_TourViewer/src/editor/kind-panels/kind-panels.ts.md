# kind-panels.ts

## Purpose

The editor half of a kind's row. `KIND_PANELS` lists, per kind of the format, its inspector panel factory, or null for a kind whose fields say everything it needs. `createKindPanels` makes them once for the shell.

## Public API

- `PanelContext`: what the shell gives a panel.
  - Page nodes: `document`, `box`, `inspectorRoot`, `treeRoot`.
  - `edits`: a `Pick` of `ShellEditCommands`.
  - `loadPicture`, `say`, `changed`.
  - `pickAsked` and `focused`: the 3D view's wait and focus for a model.
- `KIND_PANELS`: `{ shortText: null, longText, picture: null, video: null, audio: null, model, character: null }`, which `satisfies` a mapped type over `TourBlockKind`. A kind the format gains and this list lacks is a compile error.
- `createKindPanels(ctx, list = KIND_PANELS): KindPanels` (`list` is for a test's fake panels):
  - `sync(model)`: every panel follows the selection, and it returns the selected item's kind's draw, or null - never another panel's, even one that draws.
  - `act(name, model, selected)`: runs a press in the selected item's kind's panel. It is false when that panel does not take it, or nothing is selected.
  - `flush()`: every panel's pending typing.

## Invariants & assumptions

- The other half of a row (words, look, fields, add line) is `kinds/edit-kinds.ts` `KIND_EDIT`. It cannot hold the panels, because the creator pages outside the editor read it and top-level modules may not import editor code.
- Every panel is synced on every draw, not only the selected one, so a panel whose kind lost the selection lets its state go (a long text's preview closes).
- A press goes only to the selected item's kind's panel, so two kinds may use the same act name.

## Examples

```ts
const panels = createKindPanels({
  document,
  box,
  inspectorRoot,
  treeRoot,
  edits,
  loadPicture,
  say,
  changed: draw,
  pickAsked,
  focused,
});
drawInspector(dock, model, state, pictures, panels.sync(model));
if (panels.act(act, model, selected)) draw();
```

## Tests

`kind-panels.test.ts`: the list's keys equal `tourBlockKinds()`, routing and placement in the dock. Through the shell: `../editor-shell/editor-shell.test.ts` (model acts, the long text's preview and save while typing).
