# catalog/label-rule.js - which catalog labels show

- Purpose: W5 material catalog plan, M1. With 130-170 spheres, only the
  nearest K labels show, faded by distance (the research's decluttering).
- Public API:
  - `LABEL_RULE` `{ k: 16, fadeNearM: 50, fadeFarM: 140 }` (the fade was
    25-70 m until the owner asked for about twice the distance, round-3
    plan 2026-09-27-0532 §2; K swept over 16, 24 and 41 in the round-3
    record `2026-09-27-*-lookdev-tidy-results.md`).
  - `labelOpacities(distances, rule?)` - one opacity per input distance, in
    input order: the K nearest get 1 up to `fadeNearM`, falling linearly to
    0 at `fadeFarM`; all others 0. `RangeError` for a bad K or fades.
- Invariants & assumptions:
  - Ties break by input index, so equally near labels do not flicker.
  - Non-finite distances are hidden and do not count toward K.
  - A nearer shown label is never fainter than a farther one.
- Tests: `label-rule.test.mjs` (fixed cases, the owner's default
  distances, and a 200-trial sweep over K, the fades and the distances);
  `../lookdev-tidy.smoke.spec.mjs` (on the page: a label from 100 m, none
  past 140 m, and K capping the catalog view).
