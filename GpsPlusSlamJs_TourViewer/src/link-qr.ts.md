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
- `linkQrShown({ visitor, arStatus, withheld, computerScreen }): boolean` -
  true only for a visitor, with AR `"unsupported"`, a Start not withheld (a
  tour not finished yet offers nothing to open elsewhere) and a computer
  screen.
- `linkQrSvg(url): string` - the QR code of `url` (error correction M, a
  quiet zone of 2 modules) as an inline SVG string: one white square and
  one path of dark modules, `viewBox` in modules, `aria-hidden` (the box it
  is drawn into carries the label). Throws `TypeError` on an empty or
  non-string url.

## Invariants & assumptions

- The code comes from the `qrcode` package the print panel already uses
  (`print-panel.ts`); no new dependency. `QRCode.create` is synchronous, so
  the code is drawn in the render with no in-progress state (the async-UI
  rule has nothing to show).
- The SVG holds only numbers and fixed markup, so `innerHTML` with it
  carries nothing from the url into the page's markup.
- `ar-entry.ts` encodes `location.href`, the link "Copy link" copies, and
  redraws only when the address changed since the last draw.

## Examples

```ts
const shown = linkQrShown({
  visitor: true,
  arStatus: "unsupported",
  withheld: false,
  computerScreen: isComputerScreen(globalThis),
});
if (shown) box.innerHTML = linkQrSvg(location.href);
```

## Tests

`link-qr.test.ts`: when it shows (every condition alone hides it), the
media query and its failure modes, and the drawn modules read back from
the SVG against the library's own code for the link (one url, a different
url, an empty url, and a property over arbitrary web urls). `ar-entry.test.ts`
("a visitor on a phone without AR" block) pins the wiring: shown on a
computer screen with the page's link, hidden on a phone and on a device
with AR. `playwright-tests/visitor-start.spec.js` asserts the code beside
"Copy link" on the desktop viewport without WebXR.
