# qr-print.ts

## Purpose

The creator's "Print a code" step (owner-requested 2026-08-26): plan the
printable launch URL for a hosted tour zip and express the printed side
length as exact CSS centimetres — the panel renders the QR at TRUE physical
size, removing the field test's flakiest manual step (a generic generator's
unknown print scale vs the size the author types when minting).

## Public API

- `PRINT_BASE_URL = "https://gps.csutil.com/tour/"`.
- `planPrintCode(dataUrl, c): Promise<{ url; qrVersion }>` — the framework's
  MEASURED builder with `&c=` inside the fits-a-QR guarantee; the smallest
  scannable form wins (often the `~` dictionary codec, which the app's own
  launch dispatcher decodes back).
- `printedSideCss(sizeM): string` — metres → exact CSS cm (0.1 mm
  rounding); throws on non-positive/non-finite input.

## Invariants & assumptions

- **SIZE CONTRACT**: the printed side length is the QR SYMBOL without the
  quiet zone (the detector's corners outline the symbol; PnP scales by
  it). The renderer draws with margin 0 and the page supplies the quiet
  zone as CSS padding.
- Print CSS cm are physically exact only at 100% print scale — the info
  line tells the creator to disable fit-to-page.
- The URL builder guarantees ≤ QR v25 at EC Q or throws.

## Examples

```ts
const plan = await planPrintCode(dropboxUrl, "1");
await QRCode.toCanvas(canvas, plan.url, {
  errorCorrectionLevel: "Q",
  margin: 0,
});
canvasSide = printedSideCss(0.2); // "20cm" via --print-side
```

## Tests

`qr-print.test.ts` — the encode→decode round-trip through the app's own
launch dispatcher, the `&c=` inclusion, the v25 ceiling, the plain-words
rejection, and the metres→cm table. The composed panel (real builder, real
renderer, async-UI states) is proven by the print spec in
`playwright-tests/ar-mode.spec.js`.
