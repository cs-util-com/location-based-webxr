# globe-credits.ts - the credits for the imagery on screen

- Purpose: globe plan 2026-09-26-0539 §7.7. The credits line's entries.
- Public API: `creditsFor(ids)` → `{ short, full, href }[]`, merged by the
  short name, in registry order whatever order the ids arrive in (the line
  never reorders as tiles load); `RangeError` for an unknown id.
- Tests: `globe-credits.test.ts` (registry order, the entry shape, empty,
  unknown ids, and a property test: no duplicates, registry order, every
  picked source credited).
