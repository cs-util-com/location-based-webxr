# qr-print-pdf.ts

## Purpose

A printable PDF of one or more numbered QR codes, written by hand - no PDF
library, because production code here ships no third-party libraries.

## Why a PDF, when the page can already print itself

The browser's print dialog owns the paper size, the margins and a
"fit to page" toggle that silently rescales. A rescaled code is one whose
printed side no longer matches the number the pose solve was given, and
nothing about that fails loudly: the code still scans, the tour is just
placed wrong. A PDF declares its own `MediaBox` and draws at absolute
coordinates, so the only way to get the size wrong is to tell the printer
to scale it.

It is also what makes SEVERAL numbered codes in one file possible, which
is the actual request (second testing session, §4).

## Why writing it by hand costs less than it sounds

A QR code is a grid of black squares, so a page is a few hundred vector
rectangles - a content stream of `re f` operators. No image encoding, no
compression, no font embedding (the caption uses base-14 Helvetica). The
result prints at the printer's own resolution instead of a bitmap's, which
is the property that matters for something a camera has to measure.

## Public API

- `planPrintPdf(count, options): PrintPdfPlan` - the geometry, as a pure
  function. Returns the paper, the symbol side in mm, the quiet-zone block
  in mm, how many codes share a page (1 or 2), and one list of placements
  per page. Placements are in mm from the page's BOTTOM-left, which is
  PDF's own origin, so the writer does no flipping.
  - **Throws `RangeError`** when the size does not fit the paper, naming
    the size that would - floored to a whole millimetre, because rounding
    that suggestion up once produced a suggestion that was itself refused.
  - Throws for a non-whole or non-positive count, and for a non-finite or
    non-positive side.
- `buildQrPrintPdf(codes, options): Uint8Array` - the file. Each code is
  `{ size, modules, caption }`, `modules` being a row-major `size * size`
  array of dark flags (any non-zero is dark - `QRCode.create(...).modules`
  hands exactly this over).
- `PAPER_SIZES_MM` (`a4`, `letter`), `type PaperSize`.
- `PrintPdfOptions`: `paper`, `sideM` (required), `marginMm`,
  `quietFraction`, `captionMm`, `gapMm`.

## Invariants & assumptions

- **The side length is the SYMBOL**, not the printed block: the dark module
  area WITHOUT the quiet zone, exactly as `qr-print-plan.ts` defines it.
  The quiet zone is drawn around it as white space, so what a ruler
  measures across the dark modules is the number the author typed.
- **The quiet zone is 8 % of the side on each edge**, the same fraction the
  Tour Viewer's on-page print stylesheet uses. Two printing paths that
  disagreed about the quiet zone would turn one declared size into two
  different physical artefacts.
- **The margin is 6 mm and deliberately not zero.** Most consumer printers
  have an unprintable border of 3-5 mm, and content inside it is silently
  clipped - which for a QR code means it does not decode at all.
- **Rows are drawn as merged horizontal RUNS.** A version-25 symbol is
  117x117, i.e. up to 13 689 separate rectangles per code; merging each
  row's consecutive dark modules typically cuts that several-fold.
- **Rectangles overlap by 2 % vertically.** An exact seam between rows can
  render as a white hairline on some rasterisers, and a hairline through a
  finder pattern is a scan failure.
- **The matrix's row 0 is the TOP row**, and PDF's y grows upward; the
  writer inverts. A mirrored code still looks like a QR code and decodes to
  nothing, so this is pinned directly.
- **xref offsets are measured from encoded BYTES**, not string lengths. The
  two agree only while every byte is ASCII, and relying on that silently is
  how the file breaks the first time a caption is not.
- **Captions are stripped to printable ASCII** and the three PDF-string
  characters are escaped. The base-14 fonts are single-byte WinAnsi, and a
  stray multi-byte character would render as mojibake rather than fail.
- Two codes share a page only when two fit stacked, which at 16 cm they
  never do (a single block is 18.6 cm).

## Examples

```ts
import QRCode from 'qrcode';
const q = QRCode.create(launchUrl, { errorCorrectionLevel: 'Q' });
const pdf = buildQrPrintPdf(
  [{ size: q.modules.size, modules: q.modules.data, caption: 'Code 1' }],
  { sideM: 0.16, paper: 'a4' }
);
```

## Tests

`qr-print-pdf.test.ts`. The two that carry the file:

- **"keeps every code inside the printable area"** (property, over counts,
  sizes and both papers) - a block that starts inside the margin or ends
  past it is a code that comes back clipped.
- **"reproduces a real QR matrix module for module"** (property) - the
  drawn content stream is re-sampled back onto the module grid and compared
  to the source matrix. Everything the drawing can get wrong (a transpose,
  a vertical mirror, an off-by-one in the run merge, a step that drifts
  across 117 modules) produces a file that still parses and still looks
  like a QR code. There is no PDF renderer in this suite, so the drawing is
  read back instead.

Plus: the xref offsets re-derived from the produced bytes, the MediaBox and
page count, a counted rectangle total (against "parses and is empty"), the
run merging, caption escaping, the matrix orientation, and the refusal
paths - including that the size the refusal SUGGESTS is itself accepted.
