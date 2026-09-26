# catalog/index.js - the catalog's static index

- Purpose: W5 material catalog plan, M1. `CATALOG`, every entry of every
  category module, in grid order. One static import per category, because
  the deploy builder (`build-lookdev.mjs`) follows only static imports.
- Public API: `CATALOG` - the concatenated entries.
- Invariants & assumptions: adding a category module means adding its
  import here; `catalog.test.mjs` validates the result.
- Tests: `catalog.test.mjs`.
