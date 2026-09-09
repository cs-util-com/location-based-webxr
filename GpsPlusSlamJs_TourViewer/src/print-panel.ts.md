# print-panel.ts

## Purpose

The "Print a QR code for this tour" section: the measured launch URL rendered
as a QR at the TRUE physical size on paper (print CSS cm units at 100%
scale; the canvas carries the symbol only, the quiet zone is CSS padding).
On the page for everyone since the flows plan M3 (DEC-F2); its own module
since M6.

## The printed size follows the input, at print time

- `printedSideToApply(rawSize, hasCode) -> string | null` is the decision,
  exported so it can be unit-tested without a DOM (this package keeps its
  units pure and covers wiring in the Playwright specs). `null` means
  "leave `--print-side` alone": either no code is on screen, or the size
  is one `printedSideCss` refuses.
- It is called from BOTH print paths - the panel button and the window
  `beforeprint` listener - because the browser menu and Ctrl+P never reach
  the button.
- **Why it exists.** `--print-side` used to be written only inside
  `generatePrintCode`, so changing the size and pressing Print reprinted at
  the size the last _generate_ left behind. Nothing errors when this is
  wrong; the poster is simply the wrong physical size, and the pose solve
  then assumes a length the paper does not have (second testing session,
  2026-09-09, F1).

## Public API

- `wirePrintPanel(dom: PrintPanelDom): PrintPanel` - binds the generate and
  print buttons.
  - `PrintPanelDom { panel; urlInput; sizeInput; codeInput; generateButton; info; area; canvas; printButton; urlOut }`
    - `sizeInput` is SHARED with author mode's mint (one input, two
      consumers): the size a code is printed at is the size it is minted
      with.
  - `PrintPanel.presentTour(url)` - prefill the URL without clobbering typed
    text and open the panel; `archive-open.ts` calls it on every open
    (both modes; the `?qr=` boot too).

## Invariants & assumptions

- **`presentTour` replaces its OWN prefill, never the creator's typing**
  (PR #434 review). It remembers the last url it wrote; a second opened
  tour overwrites that, while text typed into the field is left alone.
  The panel opens either way, so the link on screen always belongs to the
  tour that was just opened - printing a code for the previous tour was
  the failure this closed.

- Async-UI rule: "Generating…" (disabled) → generated / an error in
  `#print-info` (the button restores either way).
- The page-fit warning rides IN `#print-info` with the "100% scale"
  instruction (PR #364 review) - a clipped code does not decode.
- The print button opens the `<details>` first: a collapsed one renders
  nothing and would print a blank page (flows plan review #13). The
  browser's own print (menu, Ctrl+P) is covered by a `beforeprint` listener
  that opens the panel when a code has been generated (owner decision,
  closing interview 2026-09-08); the e2e dispatches the event.
- Size and print plan contracts: the framework's `qr-print-plan.ts.md`.

## Examples

```ts
const print = wirePrintPanel({ panel, urlInput, sizeInput, ... });
print.presentTour("https://www.dropbox.com/.../tour.zip?dl=0");
```

## Tests

`playwright-tests/ar-mode.spec.js` - "the print panel renders a scannable
code at a declared true size" (both async-UI states, the true-size info
line, the page-fit warning, the failure path) and "opening a tour opens the
print panel prefilled with the tour's link"; `launch-and-errors.spec.js` -
the `?qr=` boot prefills it.
