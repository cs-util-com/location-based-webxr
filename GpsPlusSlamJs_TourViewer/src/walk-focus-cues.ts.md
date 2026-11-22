# walk-focus-cues.ts

## Purpose

The walk's focus in the scene (the radar-and-list prototype's scene
cues): a thin orange
beacon standing over the station the walk is about, so it can be told
from afar between roofs and trees, and a ring on the ground at its found
radius, so the visitor sees where it will be found. Both follow the focus
and go without one. Given an anchor parent (the AR world group), both
stand in one pose-free wrapper that is a deferred anchor of their own
(key `walk-focus`, `anchor-root.ts`): like a station, they hold their
place while in view and land once looked away from, so they never slide
against a station that waits. Without one, or when it refuses, on the
scene root.

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
- Their deferred-anchor key is `walk-focus` (module-internal).
- `createWalkFocusCues({ getScene, getAnchorParent? }) => { update(cue |
null), shownAt(nue) }`
  - `update` shows the cues for `cue`, or takes them away (their
    anchor released with them). `getAnchorParent` is read on each
    update; a new parent re-stands them.
  - `shownAt(nue)` - where a scene-root NUE point stands as the cues
    show it, through their anchor's correction still waiting in view
    (the breadcrumbs aim at it, `visitor-stations.ts` `wireSceneMarks`);
    `nue` itself without an anchor.

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
  `update` only moves and scales them, so it is cheap per frame. A focus
  change moves them inside their key (no commit, no jump of the key); the
  anchor's bounds are read again only when the focus or the radius
  changed (the anchor reads matrices live). `shownAt` costs two
  world-matrix updates and two matrix-vector products per guide render.
- A parent that refused (no alignment binding yet) is not asked again,
  so the refusal is logged once, until the cues are taken away.
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
  property that it never shrinks with the distance; a parent without a
  binding (on the scene, one warning, `shownAt` the identity).
- `station-anchor.integration.test.ts` "the walk's focus beacon and
  ring" - one root under a bound world group, deferred in view and landed
  out of view (checked in the commit frame); a focus change inside the
  key; the breadcrumbs led to the beacon's shown place.
- `playwright-tests/visitor-walk-radar.spec.js` - the cues stand at the
  focus, move to the next one when it is found, and go with the session.
