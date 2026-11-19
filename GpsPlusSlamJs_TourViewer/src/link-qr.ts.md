# link-qr.ts

## Purpose

The visitor's "Scan with your phone" code. On a computer whose browser
cannot show the tour in AR, the visitor screen offers "Copy link"; beside
it this module's QR code carries the same link, so the visitor moves the
tour to an Android phone with one scan. A phone without AR gets no code:
scanning it with another such phone gains nothing.

## Public API

- `COMPUTER_SCREEN_QUERY` - the media query of a computer-sized screen:
  `(min-width: 768px) and (hover: hover) and (pointer: fine)`.
- `isComputerScreen(win): boolean` - `win.matchMedia(COMPUTER_SCREEN_QUERY)`;
  `false` where `matchMedia` is missing or throws.
- `onComputerScreenChange(win, listener): void` - adds `listener` to the
  query's `change` event, so a window resized or re-pointed into (or out
  of) a computer screen re-renders the code without a reload; a no-op where
  `matchMedia` or the answer's `addEventListener` is missing or throws.
- `shareLinkOf(href): string` - the link the code holds and "Copy link"
  copies: the page's own address (its query and fragment taken off, not
  origin plus path: a `file:` page's origin reads "null" and a `blob:`
  page's path is a whole address) with its `qr` parameter only, in that
  parameter's own encoding (so a plain visitor address comes back
  unchanged); a debug or cache switch, a fragment and a user name and
  password are dropped. An address with no `qr` parameter, or one that
  does not parse, is returned as it is.
- `LINK_QR_MODULE_PX` - 3, the CSS pixels per module.
- `LINK_QR_SMALL_MODULE_PX` - 2, the CSS pixels per module for a code
  over `LINK_QR_MAX_PX` at 3 (a presigned storage link of several hundred
  bytes): still whole pixels, up to 242 px (version 25).
- `LINK_QR_MAX_PX` - 244, the largest code beside the Copy link dial:
  the visitor's column is at most 440 px with its 24 px side padding, the
  dial (`--visitor-dial` of the unsupported state) 132 to 156 px, the
  grid gap 40 px, so 244 to 268 px are left inside the column's box (196
  to 220 px inside its padding). A 244 px code may take all of the
  padding, never more: measured on the page at 1280x720 and 1000x620,
  at the natural 132 px dial and a forced 156 px one, the largest code
  at 3 px per module (243 px) and at 2 (242 px) keep the row's edges
  inside the column's, with no sideways scroll. A code over it at 3 px
  per module is drawn at 2.
- `linkQrShown({ visitor, arStatus, withheld, computerScreen }): boolean` -
  `arStatus` is the controller's own status union, not any string;
  true only for a visitor, with AR `"unsupported"`, a Start not withheld (a
  tour not finished yet offers nothing to open elsewhere) and a computer
  screen.
- `linkQrSvg(url): string` - the QR code of `url` (error correction M, a
  quiet zone of 2 modules) as an inline SVG string: one white square and
  one path of dark modules, `viewBox` in modules, `width` and `height`
  of the module count times `LINK_QR_MODULE_PX`, or
  `LINK_QR_SMALL_MODULE_PX` where 3 would exceed `LINK_QR_MAX_PX` (the
  box takes its size from it: 135 px for the shortest to 195 px for the
  longest storage provider link of the tests), `aria-hidden` (the box it
  is drawn into carries the label). Throws `TypeError` on an empty or
  non-string url, `RangeError` on a code over `LINK_QR_MAX_PX` even at
  2 px per module (a link over about 1000 bytes: for the tests'
  `https://example.test/tour/?qr=...` links, 3 px per module up to 412
  bytes, 243 px; 2 px from 413, 170 px, up to 997 bytes, 242 px; refused
  from 998, 250 px), and the library's error on a link too long for any
  QR code (past version 40, about 2300 bytes at error correction M).

## Invariants & assumptions

- The code comes from the `qrcode` package the print panel already uses
  (`print-panel.ts`); no new dependency. `QRCode.create` is synchronous, so
  the code is drawn in the render with no in-progress state (the async-UI
  rule has nothing to show).
- The SVG holds only numbers and fixed markup, so `innerHTML` with it
  carries nothing from the url into the page's markup.
- `ar-entry.ts` encodes `shareLinkOf(location.href)`, the link "Copy
  link" copies, and redraws only when that link changed since the last
  draw. A link too long for a code is caught there: no code, "Copy link"
  alone, and the rest of the render runs. A code over `LINK_QR_MAX_PX`
  even at 2 px per module takes the same path.
- A whole number of pixels per module keeps every module on whole pixels,
  so the code stays sharp; the page's CSS gives the box no size of its own.

## Examples

```ts
const shown = linkQrShown({
  visitor: true,
  arStatus: "unsupported",
  withheld: false,
  computerScreen: isComputerScreen(globalThis),
});
if (shown) box.innerHTML = linkQrSvg(shareLinkOf(location.href));
```

## Tests

`link-qr.test.ts`: when it shows (every condition alone hides it), the
media query and its failure modes, the share link (only `qr` kept, in its
own encoding, on a `file:` and a `blob:` page too), the module scale
over provider links from the shortest to the longest (each within
`LINK_QR_MAX_PX`), the step to 2 px per module and the refusal past it (a
243 px code at 3, a 170 px and a 242 px code at 2, a refused 250 px one),
the user name and password dropped, and the drawn modules read back from
the SVG against the library's own code for the link (one url, a
different url, an empty url, and a property over arbitrary web urls).
`ar-entry.test.ts` ("a visitor on a phone without AR" block) pins the
wiring: shown on a computer screen with the page's link, the share link
encoded and copied without the address's other parameters, Copy link
alone for a link too long for any code and for one whose code is over
`LINK_QR_MAX_PX` even at 2 px per module, hidden on a phone and on a
device with AR. `playwright-tests/visitor-start.spec.js` asserts the code
beside "Copy link" on the desktop viewport without WebXR.
