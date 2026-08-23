# `quest-beacon-placement.ts`

## Purpose

Turns the quest search's picks into scene positions for the 3D beacons — the
pure half of milestone **N6** (DEC-U14, executed as DEC-K4).

Pure on purpose, like `route-path.ts` and `ar-descent.ts`: `BuildingView`
constructs a `WebGLRenderer` and cannot be instantiated by the unit suite, so
anything worth proving has to live outside it.

## Public API

- `QUEST_BEACON_HOVER_M = 15` — how high the icon floats above the ground it
  marks. The field report asked for _"20 Meter […] oder 10 oder sowas"_; 15 is
  the midpoint.
- `questBeaconPlacements(picks, frame, terrain): QuestBeaconPlacement[]` — one
  placement per pick, in order.
- `QuestBeaconPlacement` — `{x, y, z, groundY, groundMeasured}`.

## Invariants & assumptions

- **One beacon per pick, up to seven** (DEC-K4). `picks` holds one entry per
  searched tile, nearest-to-user first — there is **no single "winner"**, and
  `map-view.ts` already draws a gold glyph for each. Drawing one in 3D while the
  map shows seven would manufacture a disagreement in the exact feature the field
  report raised _because_ the two disagree.
- ⚠️ **THE PLACEMENT IS ONLY AS CURRENT AS THE FIELD IT WAS COMPUTED FROM, and
  that cost the eighteenth field session a ~100 m defect (DEC-M4).** `groundY`
  comes from `terrain.heightAt`, which returns `surface − datum` — and the
  datum is **not a property of the place**, it is a property of the field: the
  orthometric height at the window centre on the desktop, and `−N` (the negated
  geoid undulation) once AR entry has resampled it. A placement computed against
  one and drawn among geometry built against the other is out by
  `N + centre height`, about **100 m** at the demo's home city.
  - So the caller must **re-derive placements whenever the field is replaced**,
    not only when the quest changes. `main.ts` does that in one function
    (`drawQuestBeacons`) called from both the `geoEvent` subscriber and the
    terrain-apply handler; `ar-entry-wiring.test.ts` guards that as source text,
    because `main.ts` cannot be unit-run.
  - ⚠️ **A DEM outage now MOVES the marks**, where it used to leave them where
    they were: the terrain handler replaces the field with `undefined` on an
    outage, and re-deriving then puts every mark on relief 0 until the DEM
    recovers. That is consistent with what the rest of the scene does with the
    same field, and `groundMeasured: false` still says the ground was not
    measured — but it is a visible drop and a re-rise in AR, where the field
    carries absolute heights, and it is a consequence of DEC-M4 rather than an
    intention of it.
  - **This module stays pure and stateless about it** — it does not remember a
    field or subscribe to anything. The rule is a caller obligation, recorded
    here because the failure is invisible from inside this file: every number it
    produced was correct for the field it was handed.
- **North is `-z`, east is `+x`, up is `+y`** — the same reflection as
  `route-path.ts`, `cell-mesh.ts` and the package's `packInstances`. A fourth
  copy disagreeing about which way is north is what
  `mesh-orientation.test.ts` exists for, and a mirrored frame shipped here once.
- ⚠️ **A pick outside the sampled terrain window gets relief 0, never the
  clamped height.** `heightAt` clamps its sample index **per axis** rather than
  refusing, so a point beyond the square is handed the edge profile extruded
  outward — finding **R2-9**, sampled at a point. It comes back as a perfectly
  ordinary number and would place a beacon on fabricated ground. `groundMeasured`
  carries which of the two happened, so the caller can decide and a test can tell
  them apart.
  - **How far out can a pick be?** Further than it looks. The search is bounded
    by the res-8 **event tile plus admitted neighbours** — about 1.08 km across,
    with candidates seeded in the bounding box — so a pick can land ~1.4–1.6 km
    away. That is still inside the ±2400 m window, but the margin is a fifth of
    what the plan's first draft claimed, which is why this branch is **asserted
    rather than trusted**.
  - **And M2 widened it**: `searchAt` admits neighbour tiles via
    `fetchTilesForScoreWorkingSet(chunk, SCORE_DISK_MAX_RADIUS)`, so raising the
    scoring radius changes which tiles are searched and how far a pick can be.
- **`terrain === undefined` is a normal state**, not an error — a DEM outage.
  Beacons are still placed, on relief 0, flagged unmeasured. Hiding them would
  make an outage look like "no quests here".
- **`y - groundY` is always exactly the hover**, measured or not, because the
  connecting line is drawn between them. A beacon whose icon and line disagreed
  would draw a stalk that misses its own marker.
- **A non-finite position is skipped, not placed.** A `NaN` reaching a scene
  position removes the object with no error anywhere — the "the 3D view is
  empty" report `render-distance.ts` guards against on the far plane.

## Examples

```ts
const frame = enuFrameAt(anchors.origin);
const placements = questBeaconPlacements(event.picks, frame, terrain);
buildingView.setQuestBeacons(placements);
```

## Tests

- `quest-beacon-placement.test.ts` — the origin case, both axis mappings, the
  out-of-window refusal, the DEM outage, one-per-pick, the non-finite skip, and
  the **datum sensitivity** above. That last one cannot fail against today's
  code and says so at length: it documents the ~100 m, while the red test for
  the actual defect is `ar-entry-wiring.test.ts`, because the arithmetic was
  never wrong — nothing re-ran it.
- `quest-beacon-descent.test.ts` — that a beacon on the content root moves with
  the AR entry fly-in, written to settle the field report's proposed cause
  (it does move; the datum was the real cause).
- `quest-beacon-placement.property.test.ts` — axis **independence** over
  arbitrary origins (|lat| ≤ 70) and offsets, northward monotonicity, and the
  constant hover. Framed as independence rather than arithmetic: asserting the
  output equals `toEnu` with the axes swapped would restate the implementation.
  - The monotonic property carries a **step floor**, for the reason this repo
    learned on `ar-fused-gps`: a bare `> 0` admits denormal doubles, which cannot
    move a metre-scale value, so the property would be false as stated rather
    than violated by the code.
- **Mutation-verified.** Dropping the `-z` reflection fails two tests; trusting
  the clamp instead of checking the window fails one.

## Related

- [`route-path.ts`](./route-path.ts.md) — the canonical lat/lng → scene example.
- [`heightfield.ts`](./heightfield.ts.md) — `heightAt`, and the clamp this module
  refuses to rely on.
