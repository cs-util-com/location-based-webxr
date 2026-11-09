# shelf-panel.ts

## Purpose

The asset shelf's panel in the editor: a dock at the right edge, right of
the inspector, that folds to a rail of progress rings; on a phone a sheet
of its own, with a progress pill over the map while the sheet is closed;
and the bottom bar's "Assets" toggle with its badge. One card per file on
the shelf, a summary of what a phone downloads with "Optimize this tour",
and filter chips per kind. It draws `selectShelfRows` and acts through the
shelf runner (`asset-shelf.ts`); every word comes from
`shelf-panel-model.ts`. Styles: `shelf-panel.css`.

## Public API

- `createShelfPanel(deps): ShelfPanel`
  - `deps.root`: the dock (`aside#shell-shelf`); its frame is built once.
  - `deps.toggle`, `deps.pill`: the bar's toggle and the phone's pill.
  - `deps.host`: where the "Used in" popover goes (the page's body).
  - `deps.rows()`, `deps.subscribe(listener)`: the shelf's rows and their
    changes (the store's).
  - `deps.retry`, `deps.useOriginal`, `deps.remove`, `deps.optimizeTour`:
    the runner's commands. `remove` returns the undo, or null when the
    file is not on the shelf.
  - `deps.addFiles()`: opens the picker for files to add.
  - `deps.placesOf(id)`: where the tour uses a file (`asset-places.ts`).
  - `deps.show(selection)`: selects and shows one of those places.
  - `deps.useIn?(id, anchor)`: offers places to use a file in; absent, no
    card offers "Use in...".
  - `deps.toast(text, action?)`: the page's toast; the action has a label
    and a `run`.
  - `deps.storage`: keeps the fold (`SHELF_FOLD_KEY`, `"1"` folded); null
    keeps nothing, and a throwing storage is read as not folded.
  - `deps.phone()`: a phone's layout (a sheet, never folded).
- `ShelfPanel`: `refresh()` redraws from the rows, `reveal(id)` unfolds
  (or opens the sheet), shows the file's card opened and flashes it,
  `open()` unfolds or opens the sheet, `destroy()` stops listening and
  closes the popover.
- `SHELF_FOLD_KEY`: the storage key of the fold.

## Behaviour

- A card: thumbnail icon per kind, name (text, never markup), its places
  ("Used in N places" as a button opening the popover, or "Not used"),
  the kind line (`Sound · WAV · 9.0 MB`) and the state line (queued with
  its place in the queue, a bar and percent while it runs, the sizes and
  the gain once smaller, kept, or failed with its reason and Retry). A
  click or Enter/Space on the card's row opens its details: "Use it
  somewhere else..." (with `useIn`), "Use the original" (when the row
  allows it; disabled with "Going back..." while it works, then a toast
  either way) and the places.
- Delete: an unused file goes at once, with a toast and its Undo. A used
  file is not deleted: an alert dialog lists the places (each a button
  that shows it) and offers "Keep it", focused; closing it returns the
  focus to the delete button. Deleting a used file would leave its places
  empty; the editor asks for those places to be changed first.
- The popover (`#shelf-pop`, a menu) lists the places; arrows move between
  them, Escape closes it and returns the focus, a pointerdown outside
  closes it.
- Folded (desktop): `body.shelf-folded`, the rail shows up to
  `RAIL_RINGS` rings of running and queued files, a ring's click reveals
  its card. The fold is kept in storage.
- Phone: `body.shelf-sheet` while the sheet is open; the pill shows only
  with the sheet closed and something to say (busy or failed).
- The toggle's `aria-pressed` says whether the shelf is open; its badge
  (`.as-badge`, `.error` when something failed) counts what is under way
  or failed.
- Redraw: a full redraw only when the rows' shape (`shapeKey`, which
  leaves out progress), the filter, the open card, the dialog or a
  "Use the original" under way changed; otherwise only the bars,
  percentages and rings move, so a running job never steals focus or
  scroll. A full redraw puts the focus back on the same file's same
  button.

## Invariants & assumptions

- Names and reasons are set as text, never as markup.
- Lookups by data attribute go through `withData` (no `CSS.escape`, which
  jsdom lacks), so any id is safe.
- The panel never changes the tour itself; every change goes through the
  runner's commands or `useIn`.
- Body classes are the layout's one switch: `shelf-panel.css` sets
  `--s-shelf-cur` from them, and the inspector, the map controls and the
  bottom panel stand left of it (`editor-shell.css`).

## Example

```ts
const panel = createShelfPanel({
  root: element("shell-shelf"),
  toggle: element("shelf-toggle"),
  pill: element("shelf-pill"),
  host: document.body,
  rows: () => selectShelfRows(store.getState()),
  subscribe: (l) => store.subscribe(l),
  retry: (id) => shelf.retry(id),
  useOriginal: (id) => shelf.useOriginal(id),
  remove: (id) => shelf.remove(id),
  optimizeTour: () => shelf.optimizeTour(),
  addFiles: () => void picker.pickMany().then(addToShelf),
  placesOf: (id) => assetPlaces(stations(), id),
  show: (selection) => select(selection, true),
  toast: (text, action) => toast(text, action),
  storage: browserStorage(),
  phone: () => matchMedia("(width <= 700px)").matches,
});
```

## Tests

`shelf-panel.test.ts` (jsdom): the frame and the empty state, cards and
their text-only names, the summary and "Optimize this tour", filters,
Retry, "Use the original" with its transitional state and both toasts,
deleting an unused file with its Undo, the used-file dialog with its
places, the popover showing a place and closing on Escape, the fold kept
in storage, the rail's rings, the bottom bar's toggle, the phone's sheet
and pill, a progress update that moves only the bar and keeps the focus,
and nothing drawn after `destroy`. The words are `shelf-panel-model.test.ts`'s.
