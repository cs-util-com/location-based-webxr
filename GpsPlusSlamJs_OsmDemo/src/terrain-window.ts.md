# `terrain-window.ts` — where the terrain is sampled, and in whose coordinates

## Purpose

Decide, for one terrain load, **which post lattice to grow** and **which frame
the resulting heights are expressed in** — as two separate answers rather than
one.

## Public API

- `FETCH_SLACK = 1.05` — how far past the sampled square the lattice is grown.
- `TerrainWindow` — `{ frame, fetchCentre, fetchRadiusM }`.
- `terrainWindowFor({ frameOrigin, centre, extentM }) => TerrainWindow`. Throws
  `RangeError` on a non-finite input.

## The distinction this module exists to make

One lat/lng used to answer three questions at once — which posts to fetch, where
to centre the sampled square, and what the resulting numbers mean. They were the
same variable, so nothing could disagree. They are not the same question:

- **The frame origin is a coordinate system.** It must stand still, or every
  height in the field is expressed against a different zero than the geometry
  standing on it.
- **The fetch centre and the sample centre are a data window.** They follow the
  user, because the ground the user is looking at is the ground worth having.

**What went wrong when they were welded together.** Round 5A moved the buildings
into the fixed frame and left the heightfield sampled in a frame anchored on the
user, while `meshOptions` kept reading building ground heights as
`field.heightAt(frame.toEnu(position))` — fixed-frame ENU against a user-frame
field. The two disagreed by exactly the user's offset from the anchor, so the
relief slid under the city by the step distance on every step. Nothing detected
it: the 5A walk test asserts on the frame origin that is _sent_, not on the
frames the subsystems then use.

## Invariants & assumptions

- **`frame` is a pure function of `frameOrigin`.** A step cannot perturb it, and
  the test asserts that bit-identically rather than approximately — an
  "approximately fixed" frame is the defect in a costume.
- **`fetchCentre` and the sampled square move together, or not at all.** Fetching
  around the user while sampling around the anchor reads posts that were never
  fetched and mean-fills them: a flat plateau where real relief exists, reported
  nowhere.
- **The sampled square is still symmetric about the frame origin**, which is why
  `fetchCentre` is the anchor rather than the user. Threading the window's offset
  through `HeightfieldData`, both terrain shaders and the ground plane is the
  second half of round 5B; until it lands, the covered ground is the anchor's
  rather than the user's.
- **`fetchRadiusM` is a SQUARE half-width, not a disc radius.** `ensureAround`
  builds a square lattice, and the grid reads a square — so treating the radius
  as a circumscribed circle over-builds by `sqrt(2)` per axis. That is measured,
  not theoretical: at the 2 400 m extent it put the lattice at ~321 000 posts
  against a 250 000 cap, so eviction ran on every load and threw away ~71 000
  posts the next load immediately re-fetched.
- **A non-finite input throws.** A `NaN` anchor makes every ENU coordinate in the
  scene `NaN`, and `NaN` geometry drops triangles _silently_ — so the failure
  surfaces as "the city did not draw", a long way from its cause. `nextAnchor`
  throws for the same reason.

## Examples

```ts
const window = terrainWindowFor({
  frameOrigin: anchors.origin, // where the scene is anchored
  centre: position, // where the user is
  extentM: TERRAIN_EXTENT_M,
});
await terrainField.ensureAround(window.fetchCentre, window.fetchRadiusM);
const field = terrainField.sampleGrid({
  frame: window.frame,
  extentM,
  spacingM,
});
```

## Tests

`terrain-window.test.ts`:

- **The regression guard** — the same anchor with two different user positions
  maps a fixed landmark to a bit-identical ENU point.
- **The counterweight** — a moved anchor _does_ move it, so "the frame never
  moves" cannot pass for an implementation that ignores its inputs.
- **Coverage** — every corner of the sampled square is inside the fetched
  lattice, asserted per axis because the lattice is a square.
- **The slack** — `fetchRadiusM` is `extentM × FETCH_SLACK`, not a `sqrt(2)`
  margin.
- **Defensive** — a non-finite anchor or a non-positive extent throws
  `RangeError`.
