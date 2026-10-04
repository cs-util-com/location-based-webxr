# catalog/validate.js - the material catalog's validator

- Purpose: W5 material catalog plan
  (`GpsPlusSlamJs_Docs/docs/2026-09-26-0549-material-catalog-plan.md`), M1.
  Checks the catalog's entries before the page builds them, so the failures
  three never reports are caught by `node --test`.
- Public API:
  - `CATEGORIES` - the categories, in grid order.
  - `MATERIAL_TYPES` - the three material classes an entry may name.
  - `LABEL_MAX` (28), `MAX_LUMINANCE` (0.85).
  - `luminance(0xRRGGBB)` - relative luminance, sRGB, no linearisation.
  - `validateCatalog(entries)` - every problem as a readable string, `[]`
    when valid.
- The entry schema: `{ id (kebab-case, unique), category, name, label (at
most 28 characters), material: { type, params } | make(THREE) + cacheKey +
color, features: string[], costNotes: string, arSafe: "unmeasured" |
verdict, notes? }`. `params.color` (or `color` for a custom shader) must
  not be near-white: the owner asked for coloured spheres.
- Invariants & assumptions:
  - A custom shader (`make`) must carry its own `cacheKey`, unique across
    the catalog; three shares one program between materials whose
    `onBeforeCompile` source is equal.
  - `arSafe` stays "unmeasured" until the cost harness (M2) has a reading
    from the named reference phone.
- Tests: `catalog.test.mjs` (the shipped catalog is valid; each rule, with
  a failing example).
