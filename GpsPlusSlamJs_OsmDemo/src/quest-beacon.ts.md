# `quest-beacon.ts`

## Purpose

The 3D quest markers — milestone **N6** (DEC-U14), scoped by **DEC-K4**. A large
gold exclamation mark floating above each quest, with a thin bright line down to
the ground it marks.

The design is the field report's own:

> "so ein gelbes 3D-Ausrufezeichen … das irgendwie einfach schön groß ist, dass
> man es auch von ein bisschen weiter weg sehen kann … und so eine dünne Linie
> nach unten hat und dann quasi im Boden im Endeffekt endet"

Built from primitives rather than loaded: it has to be legible at several hundred
metres and cost nothing to fetch.

## Public API

- `createQuestBeacons(): QuestBeacons` — `{ root, set(placements), dispose() }`.
  `set` replaces every beacon; an empty list clears them.
- `questBeaconMaterials()` — the materials, exported so
  `ar-content-materials.test.ts` can check them **by name** rather than absorb
  them into a count.

## Invariants & assumptions

- **On the AR content root, never the scene** (`BuildingView.setQuestBeacons`).
  Objects added straight to the scene are left behind when AR starts, and a quest
  you can see on the desktop but not while walking to it is the wrong half of the
  feature. `attachTo` applies `DEMO_TO_NUE` and the ENU offset to the whole
  subtree, so placements stay in demo coordinates and need **no per-object
  conversion**.
  - Pinned by the **positive** half of `building-view-content.test.ts`. The
    negative half matches only `this.scene.add(...)`, so it would not notice a
    beacon at all — the guard with teeth here is the inclusion list.
- **The line is sized from THIS beacon's drop**, `y - groundY`, not from
  `QUEST_BEACON_HOVER_M`. The two are equal only where the ground is flat, which
  is nowhere that matters; sizing from the constant leaves the line ending in
  mid-air over sloped terrain, pointing at nothing.
  - ⚠️ The first version of that test used a drop that happened to **equal** the
    hover constant, so it passed against an implementation that used the
    constant. The numbers now differ deliberately.
- **No line at all when the drop is zero.** A zero-length cylinder renders as a
  disc-shaped artefact, which reads as a rendering fault.
- **Diffuse, emissive, and fogged** — the three ways this object could exist and
  be invisible:
  - `metalness = 1` zeroes the diffuse term, and AR gives the scene nothing to
    reflect, so the marker draws **black**. `ar-content-materials.test.ts` exists
    because that has happened.
  - `fog: false` makes it refuse to fade and then **clip at the far plane**
    instead — the "prototype" preset's failure, on the one object whose job is to
    be seen from far away.
  - So the glow comes from `emissive`, which is neither.
- ⚠️ **There is deliberately NO `frustumCulled = false`, and this bullet used
  to claim the opposite.** It said the root must not be culled because a stale
  group bounding sphere would hide the marker. three.js cannot produce that
  failure: `projectObject` reads the flag only inside its `isSprite` and
  `isMesh || isLine || isPoints` branches, so on a `Group` it does nothing at
  all. The child meshes are culled individually against their own static
  geometries, which is correct. Caught by the PR #342 review.
- **Rebuilt wholesale on each `set`**, not diffed: a search returns at most seven
  picks and replaces all of them at once, so a diff would be more code guarding a
  case that does not arise.

## Known limits

### ⚠️ A quest search moves the MAP but not the 3D CAMERA

Found while trying to write an e2e for this, and it is a product gap rather
than a test one. `main.ts` calls `mapView.panTo(nearest.position)` on a
successful search, so the 2D map centres on the quest — **the 3D camera does
not follow**. In the e2e fixture the winning pick lands ~370 m from the scene
origin and is simply outside the frustum, so the beacon is drawn and never
seen.

That is the moment a user has just asked _where is the quest_, so it is worth
deciding on rather than leaving to be rediscovered. Filed, not fixed: moving
the camera on a search is a UX decision, not a defect with an obvious repair.

### Terrain updates do not re-place existing beacons

Beacons are not re-placed when the terrain window loads or moves. A quest
found during a DEM outage keeps relief 0 until the next search. It is visible and
correctly positioned horizontally; only its height and the length of its line are
stale. Re-placing on every terrain apply would need the held event threaded into
that path, which is more coupling than the case earns today.

## Tests

- `quest-beacon.test.ts` — one group per placement, wholesale replacement,
  position, the line reaching the ground, no line at zero drop, the material's
  three invisibility modes, and dispose.
  - **Mutation-verified**: sizing the line from the hover constant instead of the
    beacon's own drop fails two tests.
- **There is deliberately NO e2e.** A pixel test was written, and it was
  measuring the wrong thing: the search pans the map, which moves the camera,
  so the frame changed whether or not a beacon was drawn — while clearing the
  quest changed nothing, because the beacon was off-screen the whole time. A
  test that passes for that reason is worse than none, and this branch had
  already shipped two such assertions before catching them.
  - **Verified by screenshot instead**: beacons forced to the scene origin
    render as gold exclamation marks with lines reaching the ground, in the
    demo's own fixture. The instrumented subscriber confirms real searches
    produce valid placements (`picks=1, placements=1`, ~370 m out).
  - An honest e2e needs the camera pointed at the quest first, which is the
    open question above.
- `ar-content-materials.test.ts` — the beacon's material is in the AR set by
  name, and the count now includes it.
- `building-view-content.test.ts` — the beacon root is on the content root.

## Related

- [`quest-beacon-placement.ts`](./quest-beacon-placement.ts.md) — where each one
  stands, and why it refuses `heightAt`'s clamped value.
- [`surface-colours.ts`](./surface-colours.ts.md) — `GEO_WINNER_COLOUR`, shared
  with the 2D map so the two views match.
