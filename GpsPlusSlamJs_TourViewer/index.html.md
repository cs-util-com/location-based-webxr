# index.html

## Purpose

The tour viewer's single page: the paste-a-link form, the live streaming
stats panel, the error banner, the progressive image gallery, and the AR
entry (`#ar-root`: a hint, the status line, the AR button, and the
`?author=1` author panel), plus the collapsed Storage and Print sections
between the stats panel and the error banner (flows plan M2/M3; the print
panel sits BELOW Storage since the M1-M4 review fix #5, so "in the Print
section above" is true from the AR section). Behaviour lives in the five
wiring modules composed by `src/main.ts` (see `main.ts.md`); the page
carries only structure and its inline CSS (grid gallery, alpha-hex borders
— the stylelint csstree validator predates `color-mix()`).

The header copy names BOTH ways in (owner taste round 2026-09-04): a printed
tour code scanned with the phone camera (the `?qr=` launch that `boot()`
resolves into an open tour) and a pasted link. The hint above the AR button
says what pressing it without a tour does — a plain AR view whose code
scanner only places the visitor once a tour is open — because the viewer
pipeline scans from the first frame and read as "already searching for a
code" to the owner.

## Public API

The `data-testid` contract the e2e suite drives: `link-input`,
`open-button`, `storage-panel` (the collapsed `<details>` that holds the
clear-cache button and its one-sentence explanation - flows plan M2, hidden
entirely without a cache store), `clear-cache`, `print-panel` (the
`<details>` holding the print section, OUTSIDE `#ar-root` since flows plan
M3 - it owns `print-url`, `author-size`, `author-c`, `print-generate`,
`print-info`, `print-canvas`, `print-button`, `print-url-out`; opened and
prefilled when a tour opens), `stats`, `error`, `gallery`, `ar-hint`,
`ar-status`, `enter-ar`, `author-panel`. Renaming one is an e2e-breaking
change. `#ar-status` and `#enter-ar` must stay children of `#ar-root`
(WebXR DOM overlay composites only that subtree; enforced by
`tests/repo-config/hud-overlay-nesting.test.js`). The `#ar-hint` copy (flows
plan M4, DEC-F3) says what a tour shows - photos where they were taken once
tracking has warmed up - and that a printed code SHARPENS the placement; it
no longer promises location at codes a tour may not carry, and it keeps
"AR works without a tour" (the 2026-09-04 verdict).

## Invariants & assumptions

- `#error` carries `role="alert"` — failures must be announced, not just
  colored.
- `#stats` starts `hidden` and is revealed by the first stats render; the
  `[hidden]{display:none}` rule keeps the attribute authoritative over the
  grid/flex display values.
- The gallery is a `<ul>` of `<li><img><figcaption>` items appended in
  archive order as bytes arrive.

## Tests

Driven by `playwright-tests/*.spec.js`; the no-console-errors smoke boots
exactly this page.
