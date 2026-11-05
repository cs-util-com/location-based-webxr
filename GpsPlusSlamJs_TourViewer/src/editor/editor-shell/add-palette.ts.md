# add-palette.ts

## Purpose

The 3D view's Ctrl+K palette: one field where a creator types a kind
and a place ("long gate", "pin 3") and Enter adds it. The rows come from
`add-palette-model.ts`; the shell (`editor-shell.ts`) opens it and runs
the add.

## Public API

- `isPaletteKey(event)` - Ctrl+K or Cmd+K without Shift or Alt, by the
  key's letter, else by its place (`KeyK`) where the layout's letter is
  not Latin. Shift and Alt are left to others; the shell asks it
  outside a text area or an editable element (a line field included),
  so the long-text writer's Ctrl+K (its Link key) and the bottom
  panel's Ctrl+J and Ctrl+Shift+M stay theirs.
- `createAddPalette({ host, stations, selectedStation, add })` ->
  `{ open(), close(returnFocus), isOpen() }`:
  - `open()` - shown with an empty query over a backdrop, the focus in
    its field, the default place's rows listed (opened again while open:
    its text selected);
  - `close(returnFocus)` - hidden; with `returnFocus` the focus goes back
    to the element that had it when it opened (if still in the page);
  - `add(what)` runs after it closed, with the row's `PaletteAdd`.
- Elements: `#add-palette-back` (backdrop), `#add-palette`
  (`role="dialog"`, "Add"), `#add-palette-input` (`role="combobox"`,
  `aria-controls`, `aria-activedescendant` on the active row),
  `#add-palette-list` (`role="listbox"`), its rows `.pr` (`role="option"`,
  `aria-selected`, `.pl` the kind, `.pt` the place), `.pempty` when
  nothing matches, `.pfoot` the keys in words.

## Invariants & assumptions

- The focus stays in the field: the arrows move the active row (round at
  either end), a press on a row does not take the focus (its click adds).
- Escape closes it and goes no further (the page's Escape would drop the
  selection); Tab closes it and lets the focus move on; a press on the
  backdrop closes it with the focus back.
- It closes before it adds: the add redraws the tree, and the focus must
  already be back where it was.
- Nothing matching adds nothing (Enter does nothing).

## Examples

```ts
const palette = createAddPalette({
  host: document.body,
  stations: () => paletteStations(),
  selectedStation: () => selectedStationId(),
  add: (what) => runAdd(what),
});
window.addEventListener("keydown", (e) => {
  if (isPaletteKey(e) && !inField(e.target)) {
    e.preventDefault();
    palette.open();
  }
});
```

## Tests

`add-palette.test.ts` (jsdom): opening (focus, rows, the active one),
typing and Enter (closed first, focus back), the arrows round, a click,
no match, Escape not reaching the page, Tab and the backdrop, opening
again empty; `isPaletteKey` with Ctrl and Cmd, a non-Latin layout, and
not with Shift, Alt or another layout's letter at K's place.
