# index.html

## Purpose

The tour viewer's single page: the paste-a-link form, the live streaming
stats panel, the error banner, the progressive image gallery, and the AR
entry (`#ar-root`: a hint, the status line, the AR button, and the
`?author=1` author panel). All behavior lives in `src/main.ts`; the page
carries only structure and its ~70 lines of inline CSS (grid gallery,
alpha-hex borders — the stylelint csstree validator predates `color-mix()`).

The header copy names BOTH ways in (owner taste round 2026-09-04): a printed
tour code scanned with the phone camera (the `?qr=` launch that `boot()`
resolves into an open tour) and a pasted link. The hint above the AR button
says what pressing it without a tour does — a plain AR view whose code
scanner only places the visitor once a tour is open — because the viewer
pipeline scans from the first frame and read as "already searching for a
code" to the owner.

## Public API

The `data-testid` contract the e2e suite drives: `link-input`,
`open-button`, `clear-cache`, `stats`, `error`, `gallery`, `ar-hint`,
`ar-status`, `enter-ar`, `author-panel`. Renaming one is an e2e-breaking
change. `#ar-status` and `#enter-ar` must stay children of `#ar-root`
(WebXR DOM overlay composites only that subtree; enforced by
`tests/repo-config/hud-overlay-nesting.test.js`).

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
