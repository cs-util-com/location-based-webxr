# print-panel.ts

## Purpose

The "Print a QR code for this tour" section: the measured launch URL rendered
as a QR at the TRUE physical size on paper (print CSS cm units at 100%
scale; the canvas carries the symbol only, the quiet zone is CSS padding).
On the page for everyone since the flows plan M3 (DEC-F2); its own module
since M6.

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

- Async-UI rule: "Generating…" (disabled) → generated / an error in
  `#print-info` (the button restores either way).
- The page-fit warning rides IN `#print-info` with the "100% scale"
  instruction (PR #364 review) - a clipped code does not decode.
- The print button opens the `<details>` first: a collapsed one renders
  nothing and would print a blank page (flows plan review #13).
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
