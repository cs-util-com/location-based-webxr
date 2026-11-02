# long-text-preview.ts

## Purpose

The long text's preview over the 3D view: a phone of 390 by 844 CSS
pixels, scaled into the room left of the inspector, holding the
visitor's own reading sheet (`createLongTextSheet`, `long-text-sheet.ts`)
in a same-origin frame of its own. The sheet's media queries then see a
phone held upright, so the creator sees the visitor's bottom sheet, not
the desktop panel.

## Public API

- `PHONE_W`, `PHONE_H`, `PHONE_MAX_H` (760), `PHONE_MIN_W` (180),
  `FLASH_MS` (1400), `PREVIEW_FOLLOW_MS` (140), `FLASH_HIGHLIGHT`.
- `phoneSize(width, height)` - the drawn phone: as tall as the room
  under the head (at most 760), narrowed to the room's width, never under
  180 wide; `scale` = width / 390.
- `flashTarget(body, from, to)` - a part's first line (at most 60
  letters) and how often those words come before it; null for none.
- `findText(root, needle, nth)` - their `nth` place in the formatted
  text, as a range (the last one there when fewer).
- `createLongTextPreview(deps)` -> `{ element, show(content, now?),
flash(from, to, body), setView(name), setOpen(open), layout(), destroy() }`
  (`setView` names the text's view in the head; the dock passes
  `viewLabel(view)`); deps:
  `document`, `box` (`#view3d`), `inspector`, `tree`, `loadAsset(id)`,
  `say`, `onOpen(open)`.

## Behaviour

- The frame's page is written once (standards mode) with the sheet's
  stylesheet (`long-text-sheet.css?inline`), a grey sky and ground behind
  it, the sheet's close button hidden and a `::highlight(lw-flash)`
  rule; a page the frame replaces gets the sheet mounted again.
- `show` follows typing after 140 ms (or at once), keeping the sheet's
  scroll place; the same content is not shown again.
- `flash` lights the words with the frame's own Custom Highlight API for
  1.4 s and scrolls them to 30 % of the sheet's height.
- Links are not followed: outside AR the visitor's sheet lets a link open
  by itself, so the frame's page holds every tap on a link (a capturing
  click listener) and says so in a toast; the sheet's own link opener says
  the same during AR, which the preview never is.
- Esc in the frame closes the sheet; it opens again, as a visitor's tap
  on the sign would.
- Laid out from a `ResizeObserver` on the box, the inspector and the
  tree (where the browser has one); a "Preview" button stands in its
  place while it is closed.

## Invariants & assumptions

- The phone keeps the 390:844 shape for any room (property test).
- No sheet narration here: a voice is the next step's.

## Tests

- `long-text-preview.test.ts` - `phoneSize` (examples and property),
  `flashTarget`, `findText`.
- The frame, the sheet in it and the flash in a browser:
  `playwright-tests/editor3d-long-text.spec.js`.
