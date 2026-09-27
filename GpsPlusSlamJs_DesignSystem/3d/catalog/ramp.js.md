# catalog/ramp.js - catalog entries

- Purpose: round-3 plan
  (`GpsPlusSlamJs_Docs/docs/2026-09-27-0532-owner-feedback-round-3-plan.md`),
  DEC-FB3-1: the twelve white and gold roughness spheres that floated beside
  the city since the first look-dev page (`stand-in-scene.js` `swatches()`,
  removed), folded into the catalog as one labelled row, so the page has one
  set of spheres at one spacing, shown and hidden with the catalog.
- Public API: `RAMP_ENTRIES`, twelve catalog entries in the schema that
  `validate.js.md` describes: six white dielectrics (0xd8d8d8, metalness 0)
  and six gold metals (0xe6c07a, metalness 1), each at roughness 0, 0.2,
  0.4, 0.6, 0.8 and 1, the old spheres' exact values. Ids `ramp-white-rN`
  and `ramp-gold-rN` (N = roughness x 10). Pure data.
- Invariants & assumptions:
  - Exactly one row: `index.js` places it after the 24 standard entries, so
    it starts the third row of 12, its gold under the standard gold.
  - KNOWN OVERLAP, visible on purpose: the gold half nearly duplicates the
    standard gold row (0xe6c07a against 0xe6b85c, the same roughnesses,
    both metalness 1), and the white half is the standard red dielectric
    row in another hue. The owner chose the fold; the round-3 record shows
    the overlap and asks whether to keep both.
  - The white passes the validator's "not near-white" rule by a hair
    (luminance 0.847 against the 0.85 limit).
  - `category: "standard"`, so the city's varied materials
    (`../city-materials.js`) may pick these entries too.
- Tests: `catalog.test.mjs` (the old values, one contiguous run starting a
  row); `../lookdev-tidy.smoke.spec.mjs` (one row on screen at the
  catalog's pitch and height, labelled, gone with the catalog).
