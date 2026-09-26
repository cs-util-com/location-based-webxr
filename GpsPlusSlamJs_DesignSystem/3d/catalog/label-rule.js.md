# catalog/label-rule.js - which catalog labels show

- Purpose: W5 material catalog plan, M1. With 130-170 spheres, only the
  nearest K labels show, faded by distance (the research's decluttering).
- Public API:
  - `LABEL_RULE` `{ k: 16, fadeNearM: 25, fadeFarM: 70 }`.
  - `labelOpacities(distances, rule?)` - one opacity per input distance, in
    input order: the K nearest get 1 up to `fadeNearM`, falling linearly to
    0 at `fadeFarM`; all others 0. `RangeError` for a bad K or fades.
- Invariants & assumptions:
  - Ties break by input index, so equally near labels do not flicker.
  - Non-finite distances are hidden and do not count toward K.
  - A nearer shown label is never fainter than a farther one.
- Tests: `label-rule.test.mjs` (fixed cases and a 200-trial sweep over K,
  the fades and the distances).
