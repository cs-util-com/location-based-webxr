# in-world-text/core — pure logic

Framework-free, deterministic, unit-tested logic for the in-world text label.
**No Three.js, no DOM.** Every module is pure input → output, so it runs on a
desktop with no phone and is identical across both rendering backends.

## Modules

### `text-wrap.ts` — word wrapping

`wrapText(text, maxWidthPx, measure)` → lines. We own line-breaking (rather than
letting CSS do it on the HTML backend) so both backends produce the same lines
and therefore the same pagination. Width comes from an injected `Measure`, so the
module is DOM-free and testable with a fake monospace measurer. Explicit `\n` is a
hard break; a word wider than the line is hard-broken character-by-character;
empty/whitespace input → `[]`.

### `paginate.ts` — pagination

`paginate(lines, linesPerPage)` → pages. Always returns at least one page (empty
input → one empty page) so the panel chrome always has something to render.

### `text-page-state.ts` — page navigation reducer

`textPageReducer` over `{ pageIndex, pageCount }` with `next` / `prev` (clamped) /
`setText` (resets to page 0). Selectors `canPrev` / `canNext` / `pageLabel`
("2 / 5"). This is the single source of truth for the current page — hosted inside
each label (per-label ephemeral view state), not a store.

### `page-layout.ts` — layout + hit-mapping

`PAGE_PANEL_LAYOUT` (normalized UV rects for the text area, Prev/Next buttons, and
the page indicator) plus `hitToPageIntent(uv, nav)` → `'prev' | 'next' | null`.
Disabled-aware: a tap on a dimmed edge button is a no-op. Buttons are large
(≈0.17 m × 0.13 m on the default 0.6 m panel) for comfortable tap / XR-ray
targets. Builds on the shared `Rect` + `contains` primitive.

### `text-style.ts` — style + sizing

`resolveTextStyle(style)` turns the authorable `TextStyle` (fonts, colours, panel
width in metres) into concrete canvas pixels + plane metres. The panel is a
fixed-aspect box; `maxLinesPerPage` and the wrap width are **derived** from the
text rect and line height, so the visuals and the hit regions (which share the
layout) always line up — overflow is paginated, never clipped.

Height: default is fixed 4:3 for the width. `maxHeightMeters` (+ a `lineCount`)
lets the panel grow to fit its text up to that cap; `minHeightMeters` is a floor
that applies even to short text (e.g. to match an adjacent visual's height) —
the extra height goes to the text rect, not the footer chrome. If the minimum
exceeds `maxHeightMeters`, the maximum wins.

### `describe-panel.ts` — shared draw model

`describePanel(page, style, nav)` → `PanelDrawModel`: the one "what to draw where"
description (pixel rects, lines, nav label, enabled flags) that **both** backends
consume — the Canvas backend draws it, the HTML backend positions elements at the
same rects. Sharing it keeps the backends identical and deduplicated.

## Tests

Each module has a colocated `*.test.ts` run by `pnpm test:unit`:
`text-wrap` (word boundaries, hard breaks, newlines, empty), `paginate`
(chunking, partial/exact/empty), `text-page-state` (clamping, reset, selectors),
`page-layout` (enabled/disabled hits, chrome → null), `text-style` (derived
sizing), `describe-panel` (line layout, nav flags, empty page).
