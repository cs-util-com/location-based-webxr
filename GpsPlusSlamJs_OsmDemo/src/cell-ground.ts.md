# `cell-ground.ts` — the library/ENU boundary, in one function

## Purpose

Turns the demo's ENU heightfield into the `(cell) => metres` lookup that
`nav/obstacles.ts`'s `obstacleLevelsAt` asks for. This is the **only** place the
navigation library's frame-free world meets the demo's ENU one.

## Public API

- `groundHeightAtCell(frame, field): (cell: string) => number`
  - `frame` — the scene's `EnuFrame`, from `gps-plus-slam-osm`.
  - `field` — anything with `heightAt({x, y})`; `undefined` during a DEM outage.
  - Returns a lookup sampling the field at each cell's **centre**.
- `GroundSampler` — the one-method slice of `Heightfield` this needs.

**Error modes: none.** Nothing throws.

## Invariants & assumptions

- **The library never sees ENU, and this is why.** `nav/` holds lat/lng and H3
  cells only (DEC-R11-8). The demo's frame re-anchors on a declared place change
  or past 5 km; because the conversion lives here, a re-anchor invalidates
  coordinates **here and nowhere else** — a far smaller thing to reason about
  than an index that had stored ENU throughout.
- **Sampled at the cell centre**, matching `crossesObstacle`, which draws its
  step segments between the same points. Two different notions of "where the
  agent is" would let the ground and the obstacles disagree.
- **A non-finite sample passes through uncoerced.** `obstacleLevelsAt` turns it
  into "no levels in this cell", which is visibly unreachable. Substituting 0
  would put the agent at sea level under a hillside and read as a DEM bug.
- **No field means flat zero, not refusal.** The demo already renders flat during
  a DEM outage; refusing every cell would leave the agent unable to move at all
  rather than able to move on flat ground.

## Examples

```ts
const groundAt = groundHeightAtCell(frame, fieldFor(terrain));
const levels = obstacleLevelsAt(index, cell, groundAt);
const space = columnSpace({
  levelsAt: (c) => obstacleLevelsAt(index, c, groundAt),
  canCross: (from, to) => !crossesObstacle(index, from, to),
});
```

## Tests

`cell-ground.test.ts` — that the sample is taken at the cell centre **through
the frame** (using a field that echoes its own ENU `x`, so the test can see
which point arrived), determinism, `NaN` passthrough, the no-field case, and a
vacuous-green guard that neighbouring cells differ on a slope. That last one
matters because every other assertion passes on a constant field, and a constant
field is exactly what a broken conversion produces.

**Not yet wired into the running demo** — stage 4 of the NPC navigation plan is
what consumes it.
