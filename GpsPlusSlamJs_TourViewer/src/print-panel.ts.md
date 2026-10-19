# print-panel.ts

## Purpose

Step 3, "Print your posters": the tour's launch URL as numbered QR codes,
printed by PDF only (polish round M0b). The panel shows one preview tile per
poster, redraws whenever an input changes, continues the open tour's code
numbering, and builds the PDF through the framework's `qr-print-pdf.ts`. On
the page for everyone since the flows plan M3 (DEC-F2); its own module since
M6. Plan: `GpsPlusSlamJs_Docs/docs/2026-10-11-0049-tour-viewer-polish-round-plan.md`
(M0b).

## Why PDF only

The page used to print a code itself (print CSS at 100 % scale), next to
the PDF. The browser's print dialog owns a "fit to page" toggle that
silently rescales, and a rescaled code measures the world wrong without ever
failing - the owner's 16 cm code measured 15.3-15.5 cm (A10). The PDF
declares its own page, packs a grid of codes, carries a 10 cm check bar and
asks the viewer not to scale (`/PrintScaling /None`). So the print button,
the print stylesheet, `--print-side`, the `beforeprint` listener and the
"Generate QR" button are gone; `page-contracts.test.ts` and
`tests/repo-config/qr-quiet-zone-copies.test.js` pin their absence.

## Public API

- `wirePrintPanel({ dom, mode, onLaunchUrl?, downloadPdf?, openPdfTab?, measuredCodeIds?, measuredCodeTexts?, checkLink?, tourTitle?, posterStore? }): PrintPanel`
  - `openPdfTab` (`seams.openPdfTab`) - where the browser shows PDFs
    itself, a tab opened inside the tap, BEFORE any await (a pop-up blocker
    refuses one opened later), filled with the built PDF; the info line
    then says "Opened ...". Null or absent: the PDF is downloaded
    (`downloadPdf`). A failed build closes the empty tab.
  - `PrintPanelDom { panel; urlInput; urlAsk; urlShown; sizeInput; codeInput; info; tiles; urlOut; countInput; countDown; countUp; posterTitle; posterExplanation; posterCallToAction; paperSelect; pdfButton }`
    - `urlOut` - the first poster's launch link, an `<a>` in STEP 2 since
      the r820 feedback (R6): what the codes carry, with the pasted link
      wrapped inside; its block is hidden while it is empty.
    - The poster fields (D-P7, `poster-text.ts`): filled with the tour's
      name (`tourTitle`, its manifest title - read on present, and again
      when the codes arrive, since the manifest comes after the open) and
      the owner's wording; remembered per tour link in `posterStore` as
      typed; never overwritten by a late title once typed or stored.
    - `countDown` / `countUp` - the big -/+ of "Posters to print" (R7):
      whole posters, 1 to `MAX_PRINTED_CODES`; an unreadable count steps
      from 1.
    - `sizeInput` is SHARED with author mode's mint (one field, two
      consumers): the size a code is printed at is the size it is minted
      with. It is in centimetres, read through `printed-side.ts`.
    - `tiles` - one `<figure class="print-tile">` per poster (up to 12; the
      PDF carries all of them), each a small poster: the title and
      explanation, the canvas, the call to action and "Code n". The first tile's
      canvas keeps `data-testid="print-canvas"`, which the e2e decodes.
  - `PrintPanel.presentTour(url, { verified? })` - take the open tour's
    link, swap the field for that link as TEXT, reset the code number to 1
    for the new tour, open the panel and draw. `verified: false` (polish
    round M2, A16) is step 2's hand-off of a link whose file is not there
    yet or that could not be checked offline: the link reads
    "<url> - not verified yet" until a check confirms it.
  - `PrintPanel.presentCodes()` - the open tour's codes arrived
    (`archive-open.ts`, through the `presentTourCodes` hook): the panel
    finds the spelling of the link those codes were printed from
    (`print-link.ts` `spellingOfRecord`, r820 feedback R4) and prints in
    it from then on; the code number continues theirs unless the creator
    typed one. Until then, and for a tour without codes, the codes carry
    the link trimmed (`printableLink`: a Drive link to its file address,
    R5). The search runs only for the PRESENTED tour link (none after a
    tour from a file, which asks for a link again), a link typed into the
    field drops the spelling found, and while a tour's codes are being
    matched the PDF button reads "Matching your printed codes…" and the
    orphan warning waits - otherwise it printed new codes from 1 and
    warned about the very thing R4 reported (M0c review, findings 1-2).
    The preview tiles show the poster text as the PDF prints it
    (`winAnsiText`).
  - `PrintPanel.presentNoTour()` - back to asking for the link, the tiles
    cleared, and the poster text reset to its defaults: a left-over title
    would print the last tour's name on the next tour's posters (M4 review
    #2); the next tour's name fills it (`presentCodes`). The tour's own
    name is its own field since W2 (`tour-name-field.ts`), so the poster
    title no longer renames a tour (M4a review #9).
  - A link field cleared by the creator clears the same way (the tiles,
    the link under them, the info line; an in-flight render is dropped) -
    it used to leave the previous link's posters on screen (PR #595
    review).
  - The optional `checkLink` dep runs before the PDF while the link is
    unverified. The PDF is built either way; `recheckNote` goes in front of
    its info line, and a link that now opens drops its "not verified yet".
  - **The PDF is built from what the panel held AT THE TAP** (link,
    count, size, paper, numbering, poster text): a tour opened while the
    link is re-checked replaces the field, and must not change the PDF the
    creator asked for (PR #585 review).
- `printCountFromInput(raw)` - how many posters the PDF carries:
  `{ count, coerced, clamped }`; caps at `MAX_PRINTED_CODES` (50).
- `printPdfFilename(start, count, sideM)` - the file's name, which names
  the code range. No line is printed under the codes since the owner's
  verdict on r821 ("Code 2 - 18cm - print at 100%" went; the 10 cm bar
  carries the 100 % instruction): the PDF is built with empty captions and
  `captionMm: 0`, and `print-panel.wiring.test.ts` pins the code numbers
  the PDF is built from.
- `MAX_PRINTED_CODES`; `highestPrintedCode(codeIndex, count)` (a SUM, PR
  #443 review); `orphanScanCovers(codeIndex, count)` (exported because it is
  the claim; when false the orphaning check says nothing, PR #445 review).
- `printUrlDisplay(tourUrl, { verified? })` - which of the two spellings of
  the link shows: `{ askVisible, shownVisible, shownText }`, exactly one
  live.

## Invariants & assumptions

- **A tile canvas is sized by the stylesheet, not by the QR library.** The
  library writes an inline pixel width onto the canvas; inline beats CSS, so
  the canvas set its column's width and step 3 grew past the card on a
  phone (the owner's r819 screenshot). The inline size is removed after
  drawing; `setup-flow.spec.js` checks nothing in step 3 reaches past the
  card at 412 px.
- **Nothing a render rewrites sits above the PDF button.** The info line
  and the tiles come after it: a count typed and the button then tapped
  redraws both, and when they sat above the button they pushed it down
  under the finger (found by the PDF e2e, M0b).
- **Every input redraws** (`change`: the size, the code number, the count,
  the paper, the typed link); nothing is drawn while there is no link.
  Async-UI rule: while the tiles redraw the info line is marked
  `aria-busy` and dimmed, its TEXT kept ("Drawing the codes…" only on an
  empty line), until the new line is written; a failure writes the error
  there and hides the tiles. A render generation keeps a slower, older
  render from painting over a newer one.
- **The info line never gets shorter while a tour is shown** (its
  `min-height` holds the tallest height until another tour is presented).
  It sits under the PDF button: with the page scrolled to its bottom, a
  shorter line (or a short "Drawing…" replacing a long one) moved the page
  and the button between a tap's mousedown and mouseup, and the tap after
  editing a field missed the button (found by the PDF e2e on r830, 102 px).
- **The next PDF continues the numbering** (F4, the owner's D-R5): after a
  PDF that was saved or opened, the first code number moves to the next
  free one and the info line says how to print the same codes again; not
  when nothing was printed, nor when the creator typed another number
  while it was built.
- **The info line carries every warning about the artifact**: the range and
  size (the 100 % instruction is the step's one line of copy since the r820
  feedback), "too large for A4/Letter:
  up to X fits" (the PDF's ceiling, `maxPrintablePdfSideM`), and the
  measurement-orphaning warning.
- **Each poster gets its OWN payload** - `planPrintCode` with that code's
  index. Two posters carrying the same printed text are ONE code to the
  level lookup, which is also why the numbering continues the tour's.
- **`measuredCodeIds` is read when needed, not captured**: the open tour's
  levels arrive asynchronously after an open. `main.ts` passes the tour's
  codes together with every code this page measured, so a code measured but
  not yet finished counts for the orphaning warning and the numbering.
- **`measuredCodeTexts` (follow-up F2)**: the printed texts stored on those
  codes' levels (`main.ts`: this page's level first, else the hosted
  one), read by `printedCodes` before `spellingOfRecord`, so a spelling
  outside the searched list is printed on without a warning.
- **The OPEN TOUR'S link always wins.** `presentTour` assigns it
  unconditionally (since F7 the field is replaced by the link as text while
  a tour is open; typed text is only for the no-tour case).
- The numbering needs Web Crypto (`qrCodeId`); where it is missing (a
  plain-http preview) the number stays where it is.

## Examples

```ts
const print = wirePrintPanel({ dom, mode: "creator", downloadPdf });
print.presentTour("https://www.dropbox.com/.../tour.zip?dl=0");
print.presentCodes(); // when the tour's codes have arrived
```

## Tests

- `print-panel.wiring.test.ts` - the wiring over stand-in elements (PRs
  #584/#585 reviews): the re-check before the PDF (confirmed, failed,
  not needed, a tour opened during it and the link of the tap), the poster
  text (defaults, the late title, typed text kept, per-tour memory, into
  the PDF) and the stepper. The tiles need a real canvas and are left to
  the e2e.
- `print-panel.test.ts` - `printUrlDisplay` (with the unverified spelling),
  the PDF's inputs, the poster range, and `nextCodeIndex` (gaps, no codes,
  the limit).
- `playwright-tests/ar-mode.spec.js` - "the print panel draws one tile per
  poster at the declared size, and prints by PDF only" (the default 18 cm
  and three posters, the too-large line, no print route, the failure path),
  "opening a tour shows the code and the link it carries", and the PDF
  build's async states and numbering; `launch-and-errors.spec.js` - the
  `?qr=` boot; `setup-flow.spec.js` - an unuploaded link reaching the panel
  unverified.
