# film-phone.ts

## Purpose

The drawn phone's screen: each part's look for one phone state, where the
parts that sit on the scene go, and a thin view that writes both into the
film's markup.

## Public API

- `phoneStyles(u: PhoneState): PartStyles`: each part's inline style, as data.
- `typedTitle(u)`: `{ text, caret }` for the card's title being typed.
- `floorAnchors(eye, sw, sh): ScreenAnchors`: the drawn screens' spots (the
  3D scene projects its own, `film-scene.ts`).
- `anchorPlacement(A, sw, sh): AnchorPlacement`: each anchored part's
  place, the drawn pin's height, and the sizes that follow the code's board.
- `chipLift(chipTopPx, chipHeightPx, frameTopPx)`: how far the found-tour
  chip rises so that it clears the scan frame (3 px gap), 0 where it
  clears, never above the screen (2 px kept), 0 for input not finite.
- `screenFontPx(sw)`: 6.6 % of the screen, 13 to 17 px.
- `NARROW_SCREEN_PX` (158), `PILLS`.
- `createPhoneView(dom): { apply(u), layout(ly), place(A, ly), eye() }`.

## Invariants

- A sheet that is gone is `visibility: hidden`, not only transparent.
- The card stays within the middle of the screen whatever the pin's place.
- `layout` sets `--lf-sw` (the screen width) and `--lf-fs` (its text size)
  and `lf-narrow` below 158 px, which drops the card's body, the share
  sheet's second line, the dots, the close button, the photo caption and
  the code callout's second line, and shrinks the found-tour chip.
- The found-tour chip is as wide as its words and wraps within the
  screen; on a small screen `place` measures it and sets `--lf-chip-lift`
  so that it clears the scan frame (`board.frameTop`), covering the
  "Scan the code" pill there if it must.
- The view writes a style only when its value changed.

## Tests

`film-phone.test.ts` (jsdom).
