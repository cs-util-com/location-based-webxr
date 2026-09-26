# catalog/standard.js - catalog entries

- Purpose: W5 material catalog plan
  (`GpsPlusSlamJs_Docs/docs/2026-09-26-0549-material-catalog-plan.md`), M1:
  the physically based default swept: a red dielectric and gold, copper and steel at roughness 0-1 (24 entries), the old grey swatch rows in colour.
- Public API: one exported array of catalog entries, in the schema that
  `validate.js.md` describes. Pure data: the page builds each material from
  `material.type` and `params`.
- Invariants & assumptions: every entry passes `validateCatalog` (unique
  kebab-case ids, a coloured base colour, labels of at most 28 characters);
  `arSafe` stays "unmeasured" until the cost harness (M2) has a reading.
- Tests: `catalog.test.mjs` validates the whole catalog.
