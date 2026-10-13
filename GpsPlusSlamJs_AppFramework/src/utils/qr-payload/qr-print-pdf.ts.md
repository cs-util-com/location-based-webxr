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
compression, no font embedding (the text uses the base-14 Helvetica and
Helvetica-Bold, which every viewer and printer carries). The
result prints at the printer's own resolution instead of a bitmap's, which
is the property that matters for something a camera has to measure.

## Public API

- `planPrintPdf(count, options): PrintPdfPlan` - the geometry, as a pure
  function. Returns the paper, the symbol side in mm, the quiet-zone block
  in mm, the grid a page holds (`columns`, `rows`, `perPage`), one list
  of placements per page, and the check bar (`checkBar`: its left end,
  the bottom of its band, its 100 mm length, the band's height).
  Placements are in mm from the page's BOTTOM-left, which is PDF's own
  origin, so the writer does no flipping.
  - **Throws `RangeError`** when the size does not fit the paper, naming
    the size that would - the largest whole millimetre the SAME fit test
    accepts, so the suggestion is never itself refused.
  - Throws for a non-whole or non-positive count, and for a non-finite or
    non-positive side.
- `buildQrPrintPdf(codes, options): Uint8Array` - the file. Each code is
  `{ size, modules, caption }`, `modules` being a row-major `size * size`
  array of dark flags (any non-zero is dark - `QRCode.create(...).modules`
  hands exactly this over).
- `PAPER_SIZES_MM` (`a4`, `letter`), `type PaperSize`.
- `PrintPdfOptions`: `paper`, `sideM` (required), `marginMm`,
  `quietFraction`, `captionMm`, `gapMm`, `poster`.
- `PosterText`: `{ title?, explanation?, callToAction? }` - the poster
  text printed with EVERY code of a run (Tour Viewer polish round D-P7).
  The plan carries it laid out as `plan.poster`: `lines` (part, text,
  face, colour, em and width in mm, baseline `dyMm` from the box's bottom
  edge) and `captionDyMm`, where the code's caption moved to.

## Invariants & assumptions

- **The side length is the SYMBOL**, not the printed block: the dark module
  area WITHOUT the quiet zone, exactly as `qr-print-plan.ts` defines it.
  The quiet zone is drawn around it as white space, so what a ruler
  measures across the dark modules is the number the author typed.
- **The quiet zone is `QR_QUIET_ZONE_FRACTION` of the side on each edge**,
  IMPORTED from `qr-quiet-zone.ts` rather than restated, and the same value
  a repo-config test holds the Tour Viewer's on-page print stylesheet to.
  Two printing paths that disagreed about the quiet zone would turn one
  declared size into two different physical artefacts - which was the state
  of the code until r665, prevented only by nobody having edited one copy.
- **The margin is 6 mm, for INK, and deliberately not zero.** Most
  consumer printers have an unprintable border of 3-5 mm, and content
  inside it is silently clipped - which for a QR code means it does not
  decode at all. The symbol, its caption (at the symbol's left edge) and the
  check bar stay inside it; the white quiet-zone box only has to be on the
  sheet, because it is blank paper (polish round M0b, the owner's "as large
  as possible, as little margin as possible"). That is what fits an 18 cm
  code on A4 (208.8 mm with its quiet zone, on a 210 mm sheet); the A4
  ceiling is 18.1 cm.
- **One fit test** (`gridFor`) decides the grid, the refusal and
  `maxPrintablePdfSideM`, so the three cannot disagree.
- **A grid per page** (A11): as many columns as fit across, as many rows
  as fit above the check bar; the stack is centred across the sheet and
  vertically centred between the check bar's band and the highest a box
  top may sit (PR #586 review: this said "top-anchored", which the code
  never was); the last page holds the rest.
- **Every page carries a 10 cm check bar** (a bar with a tick per
  centimetre and a line saying to print again at 100 % if it measures
  anything else), and the catalog asks the viewer not to scale
  (`/ViewerPreferences << /PrintScaling /None >>`) - a request a print
  dialog may ignore, which is why the bar is there (A10).
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
- **Text is WinAnsi** (`pdf-text.ts`): the base-14 fonts read one byte per
  character, so Latin-1 letters (a German tour name's umlauts) are mapped
  to their byte and written as octal escapes - the file stays ASCII -
  while what the font has no glyph for (emoji, CJK) is dropped rather than
  printed as some other letter. The three PDF-string characters are
  escaped.
- **The poster text** (D-P7/D-P8): the title (bold) over the explanation
  above each code's quiet box, the call to action below it, the code's
  caption below that (an empty caption draws nothing; with `captionMm: 0`
  its band goes to the layout - the Tour Viewer prints none since the
  owner's verdict on r821); every line centred on its box. Sizes are a share of
  the SYMBOL side (title 11 %, the other two 7.5 %), so the text is scaled
  to the code. It never costs the code anything: the ceiling and the
  refusal are decided without it. What gives way, in order: the text's
  size (down to 30 %), then a row of codes per page, then a part - the
  explanation first, the title next, the call to action last (a title
  that cannot fit at all - one long word on a small code - leaves the
  explanation and the call to action, M0c review). A title or
  explanation under about 6 pt (2.2 mm em) is dropped; the call to action
  is held at that size instead, so it goes only when two lines of it no
  longer fit the code. Measured over 3-18 cm with all three texts: every
  size keeps all three, and a page loses at most one row (3, 4, 6, 7, 10
  and 11 cm lose one; 5, 8, 9 and 12-18 cm none). The text is ink: it stays inside
  the margin, off every quiet zone and above the check bar; its layout
  reserves 0.96 em above the baseline, where an accented capital (Å, Ü)
  reaches (M0c review - 0.8 em let a German title's umlauts into the
  margin at the top of an 18 cm A4 poster).
- **The caption is fitted to its code** (`captionEmMm`): 9 pt, or smaller
  so it is no wider than the symbol, so it stays inside the margin and its
  own column; at 9 pt a 3 cm code's caption ran over its neighbours and
  off the sheet (M0c review, since M0b). In A4 codes per page, the text
  costs: 3 cm 25 to 20, 4 cm 16 to 12, 6-7 cm 6 to 4, 10-11 cm 2 to 1;
  Letter also 9 cm 4 to 2 (measured after the ascent change).
- At 16 cm a page holds one code; at 8 cm four; at 5 cm a dozen or more.

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

`qr-print-pdf.render.test.ts` renders the file with **pdf.js** (a dev
dependency of that test only; production ships no PDF library) and
measures the pixels: the page at its declared A4 size, every module of an
18 cm symbol at its place (pitch, orientation, nothing cut), the check bar
10 cm to within a pixel each end, a grid run's second page carrying its
codes, and the poster text drawn above and below the code, centred to
within 2 mm, with the quiet zone blank. Mutants that shortened the bar to
99 mm, or moved the text 10 mm off centre, fail it.

`qr-print-pdf.poster.test.ts` holds the poster text in the plan: the
codes' geometry unchanged, all three texts on the 18 cm A4 poster, the
sizes in proportion, the drop order swept over 1-18 cm, an empty part
left off, a long title wrapped, rows given up only after size (swept over
3-18 cm), and a property that every line stays inside the margin, off
every quiet zone and above the check bar.

`qr-print-pdf.test.ts`. The two that carry the file:

- **"keeps all ink inside the margin and every quiet zone on the paper"**
  (property, over counts, sizes up to 19 cm and both papers) - ink inside
  the unprintable border comes back clipped; the property also holds the
  captions above the check bar and keeps any two codes apart.
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
paths - including that the size the refusal SUGGESTS is itself accepted. Since M0b also: the grid packing (five 5 cm codes on one page, four 8 cm
codes), 18 cm on A4 and Letter, the byte-level grid page and odd last page,
the check bar on every page and the no-scaling flag.
