# trainer-page.css

## Purpose

The look of the splat trainer page, taken from the chosen prototype's
stylesheet (`public/prototypes/splat-trainer-r1-c-darkroom/darkroom.css`)
with the prototype's own state switcher removed. Imported by
`trainer-page.ts`.

## Contents

- Every rule, the tokens included, is scoped under the page root class
  `.splat-page` (`PAGE_CLASS`, added by `mountSplatTrainerPage`): no rule
  reaches `html`, `body` or anything outside the mounted element, and the
  two animations are named `splat-pulse` and `splat-flash`. The page's
  `index.html` sets `body { margin: 0 }` itself.
- Colour tokens on `.splat-page` for dark (default) and light, through
  `prefers-color-scheme` (or a `data-theme` on the document root); `--print-paper` is the colour a print shows
  before its first picture and is read by the practice pictures.
- Page grid (header, main, bar), the drop area and its read bar
  (`.read-bar`, a `<progress>`), census and warning cards,
  the contact sheet (`.sheet`, `.print` and its frame, ring, mark,
  reasons, progress, live line, stamp, and the practice note
  `.print-practice`), the bar with its strip, the
  dialogs (`.veil`, `.modal`, the closer look) and the refusal card.
- States are driven by data attributes the view sets: `data-status`,
  `data-verdict`, `data-decision`, `data-stage` on a print, `data-v` on a strip
  segment, `data-dim` on the sheet, `data-wide` on the dialog,
  `data-over` on the drop area, `data-flash` on a print just shown.

## Invariants

- The sheet keeps 16 px gaps and its columns at 1024, 1280 and 1440 px
  wide; the bar stays at the bottom of the viewport. The layout e2e
  (`playwright-tests/splat-trainer.spec.js`) pins these.
- Any change is checked side by side against the prototype.
