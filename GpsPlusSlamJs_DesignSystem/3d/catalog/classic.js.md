# catalog/classic.js - catalog entries

- Purpose: W5 material catalog plan
  (`GpsPlusSlamJs_Docs/docs/2026-09-26-0549-material-catalog-plan.md`), M1:
  three's non-physical shading models (Lambert, Phong soft and hard, Basic) and the toon ramp (5 entries), for the cost comparison and non-photographic looks.
- Public API: one exported array of catalog entries, in the schema that
  `validate.js.md` describes. Pure data: the page builds each material from
  `material.type` and `params`.
- Invariants & assumptions: every entry passes `validateCatalog` (unique
  kebab-case ids, a coloured base colour, labels of at most 28 characters);
  `arSafe` stays "unmeasured" until the cost harness (M2) has a reading.
- Tests: `catalog.test.mjs` validates the whole catalog.
