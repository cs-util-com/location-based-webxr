# editor/editor-card.ts

## Purpose

The card beside the selected marker in the desktop editor (M6 E1, the
chosen variant 1's popover), editing since E2a, and the "off the map
view" chip.

## Public API

- `createEditorCard(dom, { loadImage, onClose, onReveal }): EditorCard`
  - `show(item)` - the kind ("Code 1", "Pin", "Photo" - one word per kind,
    `object-describe.ts` `BLOCK_KIND_LABEL` -
    "Station"), a note's text, a photo (see below), the precision
    line, the item's meta, "Esc close".
  - `place(anchor | null, free, avoid?)` - positions the card with
    `placePopover` (a note's lift 24 px, gap 30; a code's or station's 0
    and 26; `avoid` the box it keeps clear of, the page's debug panel), or, for a marker out of view, hides it and shows the chip
    ("<title> is off the map view", "Show it" calls `onReveal`). An item
    with no position (`anchor` null) gets the card at the free area's
    corner, without arrow or chip (E1 review #3). The card is as wide as
    the free area, up to 320 px (E1 review #7).
  - `show(item, view?)` takes a `CardView` (M6 E2a): `editable` (a pin's
    text field committed on blur or Ctrl+Enter through `onText`; Move and
    Delete through `onMove` / `onDelete`), `moving` (the drag's hint,
    Done and Cancel through `onMoveDone` / `onMoveCancel`), `moved` ("Height
    kept from the phone; on sloped ground it may be off."), `message`
    (the last outcome). The same photo stays on screen across re-renders.
  - `hide()`, `shown()`.
  - `note(text)` - the outcome line set in place (no rebuild, so a click
    that blurred the field still lands on its button, E2a review #3);
    `commit()` - commits the field's typing (a Save and a new selection
    do it first); `dirty()` - typing not yet committed (the leave guard).
  - The pin's text field is kept across re-renders of the same item, its
    typing too (a save ending mid-typing). Its count follows it
    (`#card-text-count`, an `<output>` the field is described by,
    `pin-text.ts`): "12 / 40" as it is typed, marked `data-over` past
    the 40 characters the edit refuses (`object-edits.ts`, the refusal
    shown as the card's message).
- `CARD_RESIZED` - the event the card fires when its content changed
  size (a photo landed, its error line), so the page places it again.
- `CardView`.
- The precision line (`PRECISION_LINE`, internal) - R7's two figures: "about 0.1-0.7 m near a code, 1-3 m
  further away" (M6 E1 plan review #10).

## Invariants & assumptions

- A re-render keeps the typing, the focus and the caret of the text
  field it reuses (`replaceChildren` would otherwise leave the focus on
  the page, PR #611 review).

- Every text is set with `textContent`.
- A photo is read through `loadImage`, checked by `image-cap.ts`
  `pictureProblem` (the tour's pixel cap, by its header) before an
  `<img>` decodes it, and shown through an object URL that is revoked on
  the next show and on hide. A read that fails says so in an error line
  (a file changed on disk throws on a later read).
- A photo read that lands after the card moved on is dropped (a
  generation counter).
- A code's card says it is measured on site.

## Tests

The placement is `popover-place.test.ts`; the card's photo, the capped
photo's line, Esc, the text edit (blur, Ctrl+Enter, a click right after
typing), Move with Done and Esc, and Delete with Undo are pinned by
`playwright-tests/editor.spec.js`.
