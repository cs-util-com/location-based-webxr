# index.html

## Purpose

The tour viewer's single page: the paste-a-link form, the live streaming
stats panel, the error banner, and the progressive image gallery. All
behavior lives in `src/main.ts`; the page carries only structure and its
~70 lines of inline CSS (grid gallery, alpha-hex borders — the stylelint
csstree validator predates `color-mix()`).

## Public API

The `data-testid` contract the e2e suite drives: `link-input`,
`open-button`, `clear-cache`, `stats`, `error`, `gallery`. Renaming one is
an e2e-breaking change.

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
