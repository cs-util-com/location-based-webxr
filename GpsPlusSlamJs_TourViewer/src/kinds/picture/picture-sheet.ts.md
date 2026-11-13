# `kinds/picture/picture-sheet.ts` - a picture's details sheet

## Purpose

What a tap on a picture in the world opens on the page's screen: the
whole caption, the year, the title, the credit and, for a framed print,
the picture. A cut-out's sheet shows its words only.

## Public API

- `PictureSheetContent` - `title`, `year`, `caption`, `credit`, `alt`
  (all optional) and `imageUrl` (null: text only).
- `buildPictureSheet(host, content, close) -> cleanUp`
  - a `div.picture-sheet` with `role="dialog"`, `aria-modal`, named by the
    title (else "Picture"), `data-text-only`;
  - a backdrop (`.picture-sheet-scrim`, a click asks `close`), a card with
    a Close button (focused), the image (alt: `alt`, else the caption),
    then year, title, caption and credit, each only when it has text;
  - Escape asks `close`; `cleanUp` removes the key listener and the sheet.

## Invariants and assumptions

- It never closes itself: `close` is the caller's (the part closes its
  screen panel, which runs `cleanUp`).
- Styled in `index.html` (`.picture-sheet*`); the screen's host widens to
  the whole page while it holds a sheet.

## Tests

`world.test.ts` (opened through the part: dialog, name, image or not,
Close, a second tap).
