# Road class order ignores `bridge` and `layer` (follow-up)

**Status: filed, NOT fixed (M4a review MINOR 5, r1164).** A footbridge over a
primary road is now drawn UNDER the primary where the two overlap in plan view.

**Related docs**

- `GpsPlusSlamJs_Docs/docs/2026-08-08-2344-osm-bridge-deck-drawn-at-ground-level-followup.md`
  (primary repo) - the older and larger defect: every road ribbon, a bridge
  deck included, is draped on the ground, so a `layer=1` bridge sits at ground
  level. This follow-up is a consequence of it.
- `GpsPlusSlamJs_Docs/docs/2026-11-07-2315-city-objects-and-roofscape-into-library-plan.md`
  (primary repo) §23-24 - M4a (the mitre strip and the class lift) and its
  review verdicts.
- [`2026-08-17-2215-bridge-crossing-unwired-followup.md`](2026-08-17-2215-bridge-crossing-unwired-followup.md)
  - `isBridgeCrossing`, the routing side of bridges.
- The builder: [`../src/mesh/roads.ts.md`](../src/mesh/roads.ts.md), "Classes
  are stacked by a lift".

## What happens

M4a stacks the road classes by a small vertical lift (`roadRank`: paths 0,
service and track 1, residential 2, everything else 3; `rankStepM` 5 mm a
rank), so a carriageway covers a footway that crosses it at grade. The rank
reads only `highway`. A `highway=footway bridge=yes layer=1` crossing a
`highway=primary` is ranked 0 against 3, so where the two ribbons overlap the
primary is drawn on top and the bridge appears to stop at the kerb on both
sides.

Before M4a every road sat at one height and the overlap z-fought, so the
picture was wrong then too (a flickering mix of both colours). M4a made it
stably wrong in the other direction.

## Why it is not fixed in r1164

- **The honest fix is the bridge deck itself**, which the 2026-08-08 follow-up
  files: a `layer > 0` / `bridge=*` way raised to a deck height. That moves the
  bridge above the road by metres and makes the class order irrelevant there.
  A millimetre rule here would be thrown away by it.
- **A cheaper interim rule needs a decision**: let `layer` (and `bridge`)
  dominate the rank, e.g. `rank + 4 * clamp(layer, 0, 2)`. At the 5 mm step
  a `layer=2` footbridge becomes rank 8: its strip and its discs at 8 to 8.4
  steps, 4.0 to 4.2 cm (since r1171 a way's discs sit at its strip's own
  height; before, the strip sat half a step above them, 4.25 to 4.45 cm), at
  or past OsmDemo's 4 cm rung for the areas above the roads, so the ladder
  would have to widen (the same trade the
  parked 17 mm step decision weighs). Negative layers (`layer=-1` under a
  bridge) would need the opposite clamp.
- **How often it shows is unmeasured.** First step for whoever picks this up:
  count, in the captured site fixtures, the `bridge=*` or `layer>0` ways whose
  ribbon overlaps a higher-ranked ribbon in plan view. A count near zero on the
  three O3 scenes would argue for waiting on the deck; a footbridge per scene
  would argue for the interim rule.

## Acceptance for a fix

- A unit test in `roads.test.ts`: a `footway bridge=yes layer=1` crossing a
  `primary` is higher than the primary at the crossing.
- The OsmDemo ladder test (`layer-order.test.ts`) still holds: no road above the
  4 cm rung, or the rung widened with its own test.
