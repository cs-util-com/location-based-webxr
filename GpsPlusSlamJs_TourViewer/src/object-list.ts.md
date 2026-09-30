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
- `ObjectRowModel` - `title` (a pin's text, a photo's caption or "Photo"),
  `detail` ("Pin · in the zip · 4 m from the code"), `selected`, `busy`,
  `canEditText` (pins only), `canMove` (pins only, in AR only), `enabled`.
- `SELECT_HINT` - the AR hint while nothing is selected.
- `createObjectListView(container, doc): ObjectListView` - the DOM view over
  `#object-list`: `bind(handlers)` once, `render(model)` any time.
- `ObjectListHandlers` - `editText(id, text)`, `move(id)`, `remove(id)`,
  `clearSelection()`.

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
- **Edit text is for pins only**: a photo's optional caption is shown
  nowhere in the viewer, so editing it would change nothing a visitor sees.
- **The view redraws only when the model changed** (JSON key), and the
  creator setup's model inputs change on explicit events only (a tap, a
  session start or end, a Finish) - never per store dispatch, because a
  redraw while the creator types would close the phone keyboard. An open
  editor keeps its typed text across a redraw anyway, and closes when its
  row disappears or is locked.
- The heading, hint and note elements persist across redraws: a live
  region that is replaced announces nothing.
- The distance needs the core's geodesy, which is licence-gated: the page
  constructs its store before any render (tests do the same).

## Examples

```ts
const view = createObjectListView(element("object-list"), document);
view.bind({ editText, move, remove, clearSelection });
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

- `object-list.test.ts` - the page list and the AR selection, the words per row, the
  nearest code, hidden when empty, busy and locked rows, and a property
  that the page lists every object once and AR at most the selected one.
- The DOM view: `playwright-tests/object-editing.spec.js` (edit, delete,
  move, the selected row, the overlay-tap guard).
