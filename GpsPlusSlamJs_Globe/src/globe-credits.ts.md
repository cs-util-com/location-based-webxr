# globe-credits.ts - the credits for the imagery on screen

- Purpose: globe plan 2026-09-26-0539 §7.7. The credits line's entries.
- Public API:
  - `creditsFor(ids)` returns `{ short, full, href }[]`, merged by the
    short name, in registry order whatever order the ids arrive in (the
    line never reorders as tiles load); `RangeError` for an unknown id.
  - `PROCEDURAL_STARS`: the stars' credit sentence.
  - `globeCreditsLine(credits, heights = null, extra = [])` returns
    `{ summary, links, note }`: the one-line summary (imagery, stars, the
    heights as credits or a sentence, the map's `extra`), every linked
    credit in that order, and the GIBS acknowledgement. The page renders
    it; the module touches no DOM.
- Tests: `globe-credits.test.ts` (registry order, the entry shape, empty,
  unknown ids, a property test: no duplicates, registry order, every picked
  source credited; the line's summary, links and note).
