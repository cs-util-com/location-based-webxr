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
  - `deps.dock?` (`ShelfDock`), one object because its five calls are
    right only together (an `active` without its `reveal` would make
    opening a silent no-op): while `dock.active()` the editor's panels
    are docked and the shelf is the Files panel - never a rail, its fold
    button hidden - and opening it (the toggle, the pill, `open`,
    `reveal`) calls `dock.reveal()`. Docked wins over `deps.phone()`: a
    docked phone has no sheet. `dock.shown()` says whether that panel shows: the
    toggle is `aria-pressed` only then (the page redraws it when it
    changes). `dock.hide()`: the pressed toggle pressed again,
    docked, asks the page to take the Files panel out of sight (Details in
    its place where they share a group, else its group's next panel, or
    its group hidden), so the toggle un-presses as it does over the rail.
    `dock.badge(filesBadge(rows) | null)` on every docked draw: with no
    rail of its own, the Files tab carries the count and its name.
  - `deps.host`: where the "Used in" popover goes (the page's body).
  - `deps.rows()`, `deps.subscribe(listener)`: the shelf's rows and their
    changes (the store's).
  - `deps.retry`, `deps.useOriginal`, `deps.remove`, `deps.optimizeTour`:
    the runner's commands. `remove` returns the undo, or null when the
    file is not on the shelf.
  - `deps.imports?`: `retry(id)` and `remove(id)` of the model import
    (`model-convert/model-import-runner.ts`). An import's card (queued,
    converting, failed) shows no "Used in", no "Use in..." and no
    Replace; its Retry and Remove go here, a remove refused while its
    model is being added said as "... is being added and can no longer
    be stopped.", a done one as "... was not converted.". An opened
    card of a converted model lists `madeFromLines` (`ul.as-made`).
  - `deps.setDetail(id, share)`: re-makes a model at a share of its
    triangles, null for the default level (`AssetShelf.setDetail`);
    resolves to `{ kind: "applied" }` or `{ kind: "refused", reason }`.
  - `deps.removeUsed?`: the delete of a file in use. `plan(id)` says in
    plain words what the delete does ("Deletes 2 items, removes it from 1
    other.", the session's `deletePlan`) or why it cannot be done (a long
    text shows the picture inside its words, a character is drawn with
    it); `run(id)` deletes it, the page saying so with its own Undo.
  - `deps.replace?`: "Replace everywhere". `count(id)` is how many items
    and places the replace switches (0: not offered); `run(id)` picks the
    new file and switches every use in one step, the page saying the
    outcome; it settles once all is said.
  - `deps.addFiles()`: opens the picker for files to add.
  - `deps.placesOf(id)`: where the tour uses a file (`asset-places.ts`).
  - `deps.show(selection)`: selects and shows one of those places.
  - `deps.useIn?`: `choices(id)` the groups of places a file may go
    (`use-in-choices.ts`), `use(id, key)` uses it at the chosen one; absent,
    no card offers "Use in...". The menu shows each group under its head,
    or "Nowhere yet: add a station or a story first" for none.
  - `deps.thumbOf?(row)`: the bytes a card shows as its thumbnail (a
    picture's own, a video's poster's, with a play mark); undefined keeps
    the kind's icon. Each gets one object URL (`deps.objectUrl`, default
    the browser's), revoked when the bytes change, the file goes or the
    panel is destroyed.
  - A video large for its length carries `cardWarning`'s words on its
    card (`.as-warn`), opened or not.
  - `deps.toast(text, action?)`: the page's toast; the action has a label
    and a `run`.
  - `deps.storage`: keeps the fold (`SHELF_FOLD_KEY`, `"1"` folded); null
    keeps nothing, and a throwing storage is read as not folded.
  - `deps.phone()`: a phone's layout (a sheet, never folded).
  - `deps.squeezed()` (optional): the window is too narrow for the shelf
    beside the open details panel, so the shelf shows as its rail without
    changing the stored fold; `deps.makeRoom()` (optional) is asked to
    fold the details panel when the shelf is opened while squeezed.
- `ShelfPanel`: `refresh()` redraws from the rows, `reveal(id)` unfolds
  (or opens the sheet), shows the file's card opened and flashes it,
  `open()` unfolds or opens the sheet, `destroy()` stops listening and
  closes the popover.
- `SHELF_FOLD_KEY`: the storage key of the fold.

## Behaviour

- A place with no selection (a character drawn with the file) is named in
  the popover and the delete dialog but offers no jump; the cover's
  selection (`TOUR_COVER_SELECTION`) makes the page open the tour's
  details.
- A card: thumbnail icon per kind, name (text, never markup), its places
  ("Used in N places" as a button opening the popover, or "Not used"),
  the kind line (`Sound · WAV · 9.0 MB`) and the state line (queued with
  its place in the queue, a bar and percent while it runs, the sizes and
  the gain once smaller, kept, or failed with its reason and Retry). A
  click or Enter/Space on the card's row opens its details: "Use it
  somewhere else..." (with `useIn`), "Use the original" (when the row
  allows it; disabled with "Going back..." while it works, then a toast
  either way), the places and "Replace in N places..." (with
  `deps.replace`, for a file something uses and a replace would not
  refuse whatever file is picked - `count` is 0 for a file a character
  is drawn with, whose card already says why it is kept; disabled with
  "Replacing..." and `aria-busy` while it works, back once it settled; a
  failure the page did not catch is said: "<name> could not be
  replaced."). On a phone the "Use in..." menu offers the replace too, at
  its top.
- Delete: an unused file goes at once, with a toast and its Undo; a
  delete that does nothing says why ("could not be deleted: it is no
  longer on the shelf", or "stays on the shelf: the tour still uses it"
  when the shelf put its card back because the tour names the file). A
  used file first opens an alert dialog that lists the places (each a
  button that shows it) and offers "Keep it", focused; closing it
  returns the focus to the delete button. With `deps.removeUsed` the
  dialog says in plain words what the delete does (its `plan`) and
  offers "Delete": the items made of the file go, the ones only
  mentioning it (a narration, a poster, a voice) lose it, in one step
  the page says with its Undo. When the plan refuses, the dialog says why
  and offers no Delete. Without `removeUsed` the dialog asks for the
  places to be changed first.
- A character's row (`row.character`): the character icon, his name, his
  files listed in the open card ("Sir.png · 1.0 MB"), no "Use in...".
  Its delete always asks first ("Delete Sir?" with the plan's words),
  even unused, since it takes the character out; the page runs it.
- The popover (`#shelf-pop`, a menu) lists the places; arrows move between
  them, Escape closes it and returns the focus, a pointerdown outside
  closes it.
- Folded (desktop): `body.shelf-folded`, the rail shows up to
  `RAIL_RINGS` rings of running and queued files, a ring's click reveals
  its card. The fold is kept in storage. The shelf widens in a short
  animation but narrows at once (`shelf-panel.css`): the details move
  at once, and a shelf still narrowing would lie over them
  (`editor3d-shell.spec.js` reads every frame of a fold and an unfold).
- Phone: `body.shelf-sheet` while the sheet is open; the pill shows only
  with the sheet closed and something to say (busy or failed).
- The toggle's `aria-pressed` says whether the shelf is open; its badge
  (`.as-badge`, `.error` when something failed) counts what is under way
  or failed.
- A made model's open card shows its detail (`detailView`), as the
  level-of-detail prototype's slider: "Quality, share of triangles kept"
  with the share floated right ("80 % (default)"), a range over the
  stops with the fewest triangles on the left, and a box with the stop's
  triangles ("8,000 of 10,000 triangles") and largest deviation ("320 µm
  (0.16 % of the model's size)"). Dragging (`input`) moves the readout
  only, so a redraw never takes the thumb away; letting go (`change`)
  on another stop asks `deps.setDetail` with that stop's share (the
  default level's stop asks for null). While it runs the range is
  disabled with `aria-busy` and the share reads "Applying...", the
  thumb on the stop asked for; once settled a toast says the outcome:
  "rock.glb now has 5,000 triangles." or "rock.glb was not changed."
  and the reason (a rejection reads as "It could not be made."), and the
  thumb stands on the level the tour holds. A request the author's own
  later act stopped ("use the original", a delete; outcome `stopped`)
  gets no toast. A range that had the keyboard focus gets it back once
  the request settles (disabling it dropped the focus), so the arrow
  keys step on, unless the author put the focus elsewhere meanwhile; each step is its own request. "Default detail" in the
  card's buttons goes back to the default level while another is
  chosen. A level that can no longer be changed (its original let go at
  the last save) shows its readout and says why, with no range.
- Redraw: a full redraw only when the rows' shape (`shapeKey`, which
  leaves out progress), the filter, the open card, the dialog, a
  "Use the original", a replace or a detail under way changed; otherwise only the bars,
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
  setDetail: (id, share) => shelf.setDetail(id, share),
  remove: (id) => shelf.remove(id),
  optimizeTour: () => shelf.optimizeTour(),
  removeUsed: { plan: (id) => session.deletePlan(id), run: deleteInUse },
  replace: { count: (id) => session.replaceCount(id), run: replaceEverywhere },
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
deleting an unused file with its Undo, a delete that did nothing said,
the used-file dialog with its places, its plan's words handing the
delete to the page, a refused plan with no Delete, "Replace in N
places..." busy until settled, its failure said, no offer for an unused
file, the offer in "Use in..." on a phone only, a character's one card
(his files listed, no Use in, a delete that always asks, the places he
speaks in with no Delete), the popover showing a place and closing on Escape, "Use in..."
with its groups, its empty state and its absence without the command, the fold kept
in storage, the rail's rings, the bottom bar's toggle, the phone's sheet
and pill, a progress update that moves only the bar and keeps the focus,
the thumbnails (a picture, a poster with its play mark, the icon without
one) with their object URLs let go, the video warning on an unopened
card, and nothing drawn after `destroy`. The words are `shelf-panel-model.test.ts`'s.
`shelf-panel-detail.test.ts` (jsdom): the detail's words (`formatLength`,
`detailView`, `detailReadout`) and its slider: the readout and label, the
readout following a drag with nothing asked and the thumb kept through a
redraw, the request on letting go with its busy state and toast, a
refusal and a rejection said with the thumb back, a stopped request
said not at all, the focus given back to the range but not taken from another control, the default level by
its button and by its stop, nothing asked on the same stop, and a fixed
level said with no range.
