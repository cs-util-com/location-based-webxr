# `stable-jitter.ts`

**Purpose:** the single deterministic hash every mesh builder uses to vary
instances of the same thing, so a row of trees or a street of benches does not
render as a row of clones.

## Public API

- `stableHash(text: string): number` — FNV-1a, 32-bit unsigned. Pure, total, no
  error modes.
- `unit(key: string, salt: string): number` — a value in `[0, 1)`. The salt lets
  one feature carry several uncorrelated variations.
- `mixedUnit(key: string, salt: string): number` - `unit` with MurmurHash3's
  fmix32 finaliser over the hash. The building palette uses it: plain FNV-1a
  with the salt last left a house's wall and roof picks correlated over
  sequential ids (M7 review NIT 6). `unit` itself is unchanged, because tree
  yaws, POI jitter and the skeleton nudges (and the roof tests' footprints)
  are pinned to its values.
- `stableRotationY(key: string): number` — a yaw in `[0, 2π)`.
- `stablePoiScale(key: string): number` — a size multiplier in
  `[1 − POI_SCALE_JITTER, 1 + POI_SCALE_JITTER]`, centred on 1.
- `stableNudge(key: string): { x, y }` - a planar offset in `[-1, 1)` on each
  axis, for moving a point off an exact degeneracy deterministically. The
  skeleton roof (`roof-skeleton.ts`) scales it by half a millimetre and nudges
  every footprint corner by it, so no two walls are exactly parallel.
- Constant: `POI_SCALE_JITTER` (0.05).

The salt strings (`"r"` for yaw, `"s"` for scale, `"nx"` / `"ny"` for the
nudge) are module-private named
constants. They are deliberately NOT exported: a caller that picks its own salt
is a second convention, which is the drift this module exists to prevent. Ask
for a named helper instead.

## Invariants & assumptions

- **Stability is the point, not randomness.** The demo rebuilds its entire
  working set on every position change. A value from `Math.random()` would make
  a marker rotate as the user walks past it and would make the same street look
  different on two phones side by side. Everything here is a pure function of a
  feature key.
- **Order-independence.** There is no sequence and no state, so a feature's
  variation cannot change because a neighbour entered or left the working set. A
  seeded PRNG would not give this.
- **Salts must agree across builders.** `trees.ts` and `poi.ts` both go through
  `stableRotationY`, so they cannot pick different salts for the same axis —
  that would be silent drift, since both results still look random.
- **`POI_SCALE_JITTER` is bounded by a decision, not by taste.** DEC-R6-8 keeps
  POI models at real-world scale so a marker is evidence about the extruder;
  jitter wide enough to notice destroys that evidence.

## Examples

```ts
import { stableRotationY, stablePoiScale } from "./stable-jitter.js";

const key = "node/123456";
stableRotationY(key); // same value on every run, device and republish
stablePoiScale(key); // e.g. 1.0231
```

## Tests

- `stable-jitter.test.ts` - `stableNudge`: determinism, the `[-1, 1)` band,
  all four quadrants, and salts distinct from yaw and scale; `mixedUnit`:
  determinism, the `[0, 1)` band, distinct from `unit`.
- `building-palette.property.test.ts` - the chi-square independence of the
  palette's wall and roof picks, which rests on `mixedUnit`.

- `poi-jitter.test.ts` — determinism across builds, spread over all four
  quadrants, the scale band, order-independence, and that POI yaw equals
  `unit(key, "r") * 2π` (i.e. the same hash the trees use).
- `buildings.test.ts` — the pre-existing `stableHash` determinism assertions,
  which moved here with the function.
- `trees.test.ts` — tree height and rotation variation, unchanged by the
  extraction.
