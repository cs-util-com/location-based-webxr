# qr-quiet-zone.ts

## Purpose

The one statement of the printed QR code's quiet zone and the home-printer
paper budget. No imports, no behaviour - three constants that every code
path putting a symbol on paper must agree about.

## Public API

- `QR_QUIET_ZONE_FRACTION` (`0.08`) - the quiet zone as a fraction of the
  symbol side, on **each** edge.
- `HOME_PRINTABLE_WIDTH_M` (`0.19`) - the printable width a home printer
  can be relied on for, on A4/Letter with default margins.
- `QR_PRINT_FOOTPRINT_FACTOR` (`1.16`) - what one metre of declared side
  occupies on paper: symbol plus quiet zone on both edges.

## Invariants & assumptions

- **A disagreement here is a physical defect, not a rendering one.** Two
  printing paths using different fractions produce two different artefacts
  from one declared size, and the visitor's pose solve is told that
  declared size in metres - so one of the two is silently scaled wrong on
  its least-constrained axis. That is why the number is a module rather
  than a constant in whichever file happened to need it first.
- **The consumers are three, and one of them cannot import.**
  - `qr-print-plan.ts` derives `MAX_HOME_PRINTABLE_SIDE_M` from all three.
  - `qr-print-pdf.ts` uses the fraction as its default quiet zone. It is a
    deliberate zero-dependency leaf, which is the reason these constants do
    not live in `qr-print-plan.ts`: importing from there would drag in the
    launch-URL builder, the dictionary codec and base32 to read a float.
  - The Tour Viewer's print stylesheet, which is markup and cannot import.
    `tests/repo-config/qr-quiet-zone-copies.test.js` holds it, and the
    prose that quotes the number, to this file.
- **`QR_QUIET_ZONE_FRACTION` is not four modules, and that is deliberate.**
  Four modules is a fraction of the SYMBOL, so it grows as the symbol
  shrinks; every hosting shape this product recommends prints at QR
  version 5 to 8, where four modules is 8.2 % to 10.8 %. "Compliance" would
  shrink every real printed code. Pinned by
  `qr-print-plan.test.ts`.

## Examples

```ts
const ceiling = HOME_PRINTABLE_WIDTH_M / QR_PRINT_FOOTPRINT_FACTOR; // ~16.4 cm
const quietMm = sideMm * QR_QUIET_ZONE_FRACTION;
```

## Tests

No test of its own - a file of three literals has no behaviour. What is
tested is that nothing disagrees with it:
`tests/repo-config/qr-quiet-zone-copies.test.js` (the markup copy, the
prose copy, the PDF's import, and the ceiling's derivation, each verified
by mutation), and `qr-print-plan.test.ts` for the measurement that says the
value is right.
