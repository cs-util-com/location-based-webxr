# catalog/index.js - the catalog's static index

- Purpose: W5 material catalog plan, M1. `CATALOG`, every entry of every
  category module, in grid order. One static import per category, because
  the deploy builder (`build-lookdev.mjs`) follows only static imports.
- Public API: `CATALOG` - the concatenated entries.
- Invariants & assumptions: adding a category module means adding its
  import here; `catalog.test.mjs` validates the result. Order is grid
  order, 12 per row: the 24 standard entries (two rows), the old white and
  gold ramp (`ramp.js`, one row, round-3 plan 2026-09-27-0532 DEC-FB3-1),
  then classic and toon. The ramp must start a row (`catalog.test.mjs`
  checks it; the page's smoke checks the row on screen).
- Tests: `catalog.test.mjs`.
