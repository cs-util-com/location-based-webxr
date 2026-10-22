# walk-focus-cues.ts

## Purpose

The walk's focus in the scene (visitor walk W4 build plan
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md`,
M5, §1.7; the radar-and-list prototype's scene cues): a thin orange
beacon standing over the station the walk is about, so it can be told
from afar between roofs and trees, and a ring on the ground at its found
radius, so the visitor sees where it will be found. Both follow the focus
and go without one.

## Public API

- `WALK_BEACON_NAME`, `WALK_FOCUS_RING_NAME` - the meshes' names (tests
  find them in the scene by these).
- `WALK_BEACON_FROM_M = 4`, `WALK_BEACON_TO_M = 26` - the beacon's span
  above the ground (the prototype's).
- `WALK_BEACON_MIN_RADIUS_M = 0.05`, `WALK_BEACON_MAX_RADIUS_M = 0.6` -
  the beacon's radius bounds; between them it is 0.0015 times the
  distance (a module constant).
- `walkBeaconRadiusM(distanceM)` - the prototype's 5 cm near, growing
  with the distance (about 0.17 degrees of width, 2-3 px on a phone) far
  off, capped at 0.6 m; 5 cm for a distance that is no positive number.
- `type WalkFocusCue = { id, at, eye, foundM, distanceM }` - the station's
  spot (NUE; its up part ignored), the camera now (NUE), the found
  radius, the horizontal distance.
- `createWalkFocusCues({ getScene }) => { update(cue | null) }` - shows
  the cues for `cue`, or takes them away.

## Invariants & assumptions

- In the scene root's GPS-world NUE, like the breadcrumbs: x north, y up,
  z east. The ground is the camera's height less `EYE_HEIGHT_M`
  (`breadcrumbs.ts`), not the station's own height.
- Defensive: a null cue, no scene, or an `at` or `eye` that is not finite
  takes both meshes away; a new scene moves them there (removed from the
  old one first).
- Removed through the object they were added to as well as by
  `removeFromParent`: the e2e fakes' scene keeps no `parent` link.
- One beacon and one ring for the page's life, like the creator's ring:
  `update` only moves and scales them, so it is cheap per frame.
- Never a tap target: the beacon's `raycast` is a no-op, and the ring is
  `station-ring.ts`'s, which takes no taps either.
- The look (the colour `WALK_RADAR_COLOURS.accent`, opacity 0.28 for the
  beacon and 0.55 for the ring, a six-sided open cylinder) is the
  builder's reading of the prototype; a field test on a phone decides.
- The station guide says when (`station-guide.ts` `onFocusCue`): a focus,
  a heading earned, a distance shown, a pose for the station; null
  otherwise and at the session's end. `visitor-stations.ts` passes the
  cue on.

## Examples

```ts
const cues = createWalkFocusCues({ getScene: () => seams.getScene() });
cues.update({
  id: "well",
  at: [82, 400, 34],
  eye: [0, 401.5, 0],
  foundM: 5,
  distanceM: 88.8,
});
cues.update(null); // both gone
```

## Tests

- `walk-focus-cues.test.ts` - the beacon's span over the focus and the
  ring at its found radius on the ground, in the walk's orange; following
  the focus, going without one and coming back as the same meshes; no
  scene, input that is no number, and a scene change; a scene that keeps
  no parent link; never taking a tap; the radius's bounds and the
  property that it never shrinks with the distance.
- `playwright-tests/visitor-walk-radar.spec.js` - the cues stand at the
  focus, move to the next one when it is found, and go with the session.
