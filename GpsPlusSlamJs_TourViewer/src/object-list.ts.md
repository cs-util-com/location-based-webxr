# object-list.ts

## Purpose

The creator's list of the tour's objects (authoring plan
2026-09-28-0953 §3.4, milestone M4; owner item 6: "create works; move,
edit and delete do not"): every object the tour will carry - the hosted
zip's and this device's - with **Edit text**, **Move to the reticle** and
**Delete**. A pure model half and a DOM half.

## Public API

- `objectListModel(state: ObjectListState): ObjectListModel` - pure.
  - `state.entries` - `{ object, hosted, changed }` per object, in the order
    the Finish writes them (`object-editing.ts` `authoringObjects`).
  - `state.codes` - the stored codes' geo; each row says how far the object
    is from the nearest one ("11 m from the code", whole metres).
  - `state.inAr` - on the page every row is in `rows`; in AR `rows` holds
    only the selected object (none while nothing is selected, with
    `SELECT_HINT`), and there is no heading.
  - `state.busy` - an action in flight per id (its busy label); `locked`
    (a Finish is rebuilding) disables every row.
  - `state.note` - the last action's outcome or failure, shown under the
    list (an `aria-live` region).
  - `state.undo` - the last delete can still be undone (M4 review #5): the
    model's `undo` puts an **Undo** button on the note's line, on the page
    and in AR, and keeps the list shown though the delete emptied it.
- `ObjectRowModel` - `title` (a pin's text, a photo's caption or "Photo"),
  `detail` ("Pin · in the zip · 4 m from the code"), `selected`, `busy`,
  `canEditText` (pins only), `canMove` (pins only, in AR only), `enabled`.
- `SELECT_HINT` - the AR hint while nothing is selected.
- `createObjectListView(container, doc): ObjectListView` - the DOM view over
  `#object-list`: `bind(handlers)` once, `render(model)` any time.
- `ObjectListModel.chooser` - in AR with any object, `{ position }`:
  "2 of 5" for the selection's place, "5 objects" ("1 object") before one;
  null on the page and with no objects. The view draws it as one line,
  `‹ Previous` / position / `Next ›` (`object-previous`,
  `object-position`, `object-next`).
- `ObjectListHandlers` - `editText(id, text)`, `move(id)`, `remove(id)`,
  `undo()`, `step(1 | -1)` (the chooser).
- `ObjectRowModel.compact` - in AR: the row is drawn as ONE line of text
  (title, the chooser's position, the distance - `detail` holds only the
  distance in AR) over ONE line of buttons with short labels: `‹`, Edit,
  Move, Delete, `›` (accessible names "Previous object", "Edit text",
  "Move to the reticle", "Delete", "Next object"). `chooser.inRow` says the
  chooser's buttons and position are in the selected row rather than on
  their own line; the view moves the SAME elements, so no test id is ever
  doubled.

## Invariants & assumptions

- **On the page every object is listed exactly once; in AR at most the
  selected one** (property test). The AR overlay IS the screen and cannot
  be scrolled: an "All objects" disclosure, even collapsed, laid its
  buttons out below the first screen of a 360x640 phone
  (`ar-layout.spec.js`), so AR shows only what a tap selected and the page
  lists everything.
- **Move is offered only where it can work**: a pin, in AR. A photo's pose
  is where it was taken, and the page has no reticle; the page's hint says
  where moving happens instead of offering a button that can only fail.
  **The page list still has no Move** (2026-10-01): it needs the reticle,
  which exists only in a session.
- **The selected state is ONE line of buttons in AR** (2026-10-01). With
  the chooser on a line of its own and the row's Edit / Move / Delete /
  Done on two more, the layout e2e found those four below the first screen
  of a 360x640 phone with the code's re-measure offered. The chooser now
  joins the selected row, the labels are short, the row's text is one
  line, and Done is gone: a tap on empty scene clears the selection.
  Before a selection the chooser keeps its own line (with the hint).
- **In AR every object can be reached without aiming** (M4 review #4): a
  tap selects through the tapped point with a tolerance
  (`object-pick.ts`), but a far, small or occluded object may still be
  impossible to tap - and Move acts on the selection - so the chooser
  steps through every object in list order, wrapping; with nothing
  selected, Next starts at the first and Previous at the last. One line,
  so the first-screen rule holds (`ar-layout.spec.js` covers the selected
  state with the re-measure button shown).
- **Edit text is for pins only**: a photo's optional caption is shown
  nowhere in the viewer, so editing it would change nothing a visitor sees.
- **The view redraws only when the model changed** (JSON key), and the
  creator setup's model inputs change on explicit events only (a tap, a
  session start or end, a Finish) - never per store dispatch, because a
  redraw while the creator types would close the phone keyboard. An open
  editor keeps its typed text across a redraw anyway, and closes when its
  row disappears or is locked.
- The heading, hint and note elements persist across redraws: a live
  region that is replaced announces nothing. The Undo button sits on the
  note's line but outside the live region, so the outcome is announced
  rather than the button; the line adds no row over the camera.
- The distance needs the core's geodesy, which is licence-gated: the page
  constructs its store before any render (tests do the same).

## Examples

```ts
const view = createObjectListView(element("object-list"), document);
view.bind({ editText, move, remove, undo, step });
view.render(
  objectListModel({
    entries,
    codes,
    inAr: false,
    selectedId: null,
    busy: new Map(),
    locked: false,
    note: "",
  }),
);
```

## Tests

- `object-list.test.ts` - the chooser's position and count, the page list and the AR selection, the words per row, the
  nearest code, hidden when empty, busy and locked rows, and a property
  that the page lists every object once and AR at most the selected one.
- The DOM view: `playwright-tests/object-editing.spec.js` (edit, delete,
  move, the selected row, the overlay-tap guard).
