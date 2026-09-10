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
  - `PrintPanelDom { panel; urlInput; urlAsk; urlShown; sizeInput; codeInput; generateButton; info; area; canvas; printButton; urlOut }`
    - `sizeInput` is SHARED with author mode's mint (one input, two
      consumers): the size a code is printed at is the size it is minted
      with.
  - `PrintPanel.presentTour(url)` - take the open tour's link, swap the
    field for that link as TEXT, open the panel and render the code;
    `archive-open.ts` calls it on every open
  - `printCountFromInput(raw)` - how many posters the PDF carries:
    `{ count, coerced, clamped }`. Delegates to the code number's own
    coercion rather than repeating it, and caps at `MAX_PRINTED_CODES`
    (50) - each poster is its own QR build and its own page of vector
    rectangles, all on the main thread.
  - `printPdfFilename(count, sideM)`, `printedCodeCaption(index, count,
sideM)` - what the file is called and what is printed under each code.
    The caption is read while hanging posters, so it names WHICH poster;
    it is plain ASCII because a PDF base-14 font is single-byte.
  - `MAX_PRINTED_CODES`. The orphan scan's own budget is NOT exported -
    it is an alias of that constant, and two exported names for one value
    are a duplicate export that fails the dead-code check. Ask
    `orphanScanCovers` instead, which is the question anyway.
  - `highestPrintedCode(codeIndex, count)` - the last poster a run
    produces, `codeIndex + count - 1`. A SUM, not the larger of the two:
    taking the max covered 1..3 for a creator starting at 3 with three
    posters, whose posters are 3, 4 and 5 (PR #443 review).
  - `orphanScanCovers(codeIndex, count)` - whether the orphaning check
    reaches every poster in a run.
    - **Exported because it is the CLAIM, and a claim that lives only in a
      comment is one no test can hold.** The comment used to say every set
      the app can print is covered; that is false, because
      `MAX_PRINTED_CODES` caps the COUNT while the start index is
      uncapped - so a creator printing code 60 never gets the warning at
      all (PR #445 review).
    - When it is false the check says NOTHING. A half-scanned range can
      only produce a false warning, and telling a creator to undo a change
      they never made is worse than silence.
  - `printUrlDisplay(tourUrl)` - the pure rule behind that swap:
    `{ askVisible, shownVisible, shownText }`. Exactly one of the two is
    ever live, which is what stops them disagreeing about which link the
    printed code carries.
    (both modes; the `?qr=` boot too).

## The printable PDF (second testing session, M4)

"Download PDF to print" builds N numbered posters in one file, through
`gps-plus-slam-app-framework/utils/qr-payload/qr-print-pdf` (which is
where the geometry and the byte writing live, with their own sidecar).

- **Why a PDF at all**, when the page can already print itself: the print
  dialog owns the paper and a "fit to page" toggle that silently rescales,
  and a rescaled code measures the world wrong without ever failing.
- **Each poster gets its OWN payload** - `planPrintCode` with that code's
  index. Two posters carrying the same printed text are ONE code as far as
  the level lookup is concerned, so an author who hung them in two places
  would get one of the two positions at random.
- The builds run **sequentially**: the payload builder measures QR
  versions, and fifty of those at once buys nothing on one thread.
- The outcome lands in `#print-info`, the same line the on-page print
  instructions use, so an author reads one place. A size no paper can hold
  arrives there as the framework's message, which names the size that
  would fit.

## Invariants & assumptions

- **The info line carries every warning about the artifact.** The page-fit
  warning, the PDF's wider ceiling, and the measurement-orphaning warning
  all ride `#print-info` rather than separate channels: they are about the
  thing the creator is one tap from producing, and a second channel is a
  second thing not to read.
- **`measuredCodeIds` is read at PRINT time, not captured at wiring.** The
  open tour's levels arrive asynchronously after an open, and a tour can be
  swapped without the panel being rewired. It defaults to none, so a panel
  wired without it never warns rather than warning wrongly.

- **The OPEN TOUR'S link always wins.** `presentTour` assigns it
  unconditionally. It used to preserve text the creator had typed (PR #434
  review), which was right while the field was visible; since F7 the field
  is REPLACED by the link as text whenever a tour is open, so a hidden
  field holding something else would make the code carry one URL while the
  panel displays another. Typed text is only for the no-tour case, and an
  open supersedes it. The panel opens either way, so the link on screen
  always belongs to the
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
