# globe-target.ts - where the globe turns to

- Purpose: globe plan 2026-09-26-0539 §7.5, M2. The target for the intro's
  turn: from the URL, from a GPS fix, or a fallback once the wait for a fix
  has run out. Phase 1 has no GPS (DEC-PRG-10), so the lab passes
  `fix: null`.
- Public API:
  - `LatLng` - `{ lat, lng }` in degrees, WGS84.
  - `GLOBE_FALLBACK_TARGET` - OsmDemo's opening frame, Central Park
    (40.7677, -73.9807), frozen. Phase 5 injects OsmDemo's own start
    position and this literal goes.
  - `parseLatLngText(text)` → `LatLng | undefined`. One `"lat,lng"` token;
    spaces around each number are allowed. Anything else is `undefined`:
    null, empty or whitespace (the `Number("")` is 0 trap), a missing half,
    more than two parts, non-decimal forms (hex, `Infinity`, `NaN`) and
    values outside ±90 / ±180. -0 reads as 0.
  - `chooseGlobeTarget({ url, fix, fallback, fixWaitExpired })` →
    `{ target, source }`, with `source` one of `url`, `fix`, `fallback`,
    `waiting`. Precedence: url, then fix, then the fallback only once
    `fixWaitExpired`; before that `{ target: null, source: "waiting" }`.
- Invariants: `target` is null exactly when `source` is `waiting`; a
  parsed target is always in range.
- DEC-H3: OsmDemo's `?lat=&lng=` parser (`start-position.ts`) reads a
  different input form. If phase 5 wants `?at=` in OsmDemo, it reuses this
  parser rather than adding a third.
- Tests: `globe-target.test.ts` (examples, the absent cases, a round-trip
  and a never-out-of-range property, the precedence table, and a property
  over all inputs).
