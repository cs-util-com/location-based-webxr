# walk-focus-cues.ts

## Purpose

The walk's focus in the scene (the radar-and-list prototype's scene
cues): a thin orange
beacon standing over the station the walk is about, so it can be told
from afar between roofs and trees, and a ring on the ground at its found
radius, so the visitor sees where it will be found. Both follow the focus
and go without one. Given an anchor parent (the AR world group), both
stand in one pose-free wrapper in their focus station's deferred-anchor
key (`station:<id>`, `stationAnchorKey`, as the story figure,
`anchor-root.ts`): they share that station's matrix, so they hold and
land with its content and never stand apart from it. The accepted
trade-off: a beacon in view holds its station's content's correction
too. Without a parent, or when it refuses, on the scene root.

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
- Their deferred-anchor key is the focus station's, `station:<id>`.
- `createWalkFocusCues({ getScene, getAnchorParent? }) => { update(cue |
null), shownAt(id, nue) }`
  - `update` shows the cues for `cue`, or hides them for null:
    anchored, the wrapper stays in its key, hidden (so a short gap is no
    new placement); on the scene root they leave it. `getAnchorParent`
    is read on each update; a new parent or a new focus id releases the
    wrapper and stands it in the new key, at that key's matrix.
  - `shownAt(id, nue)` - where station `id`'s scene-root NUE spot stands as the cues
    show it, through their anchor's correction still waiting in view
    (the breadcrumbs aim at it, `visitor-stations.ts` `wireSceneMarks`);
    `nue` itself without an anchor, or while the cues stand in another
    station's key (the guide hands the breadcrumbs a new focus before
    its cue; a null cue keeps the old key), so the dots never take one
    station's held correction for another's spot.

## Invariants & assumptions

- In the scene root's GPS-world NUE, like the breadcrumbs: x north, y up,
  z east. The ground is the camera's height less `EYE_HEIGHT_M`
  (`breadcrumbs.ts`), not the station's own height.
- Defensive: no scene takes both meshes away; a null cue, or an `at` or
  `eye` that is not finite, hides the anchored wrapper (a hidden root
  counts as out of view, so a correction lands unseen unless the
  station's content holds the key in view) and takes the meshes off the
  scene root otherwise; a new scene moves them there (removed from the
  old one first).
- Removed through the object they were added to as well as by
  `removeFromParent`: the e2e fakes' scene keeps no `parent` link.
- One beacon and one ring for the page's life, like the creator's ring:
  `update` only moves and scales them, so it is cheap per frame. A focus
  change stands them in the new station's key, at its matrix, never on a
  correction an earlier focus held back; the anchor's bounds are read
  again only when the radius changed (the anchor reads matrices live). `shownAt` costs two
  world-matrix updates and two matrix-vector products per guide render.
- A parent that refused (no alignment binding yet) is asked again on each
  update, quietly (`anchorRoot`'s `warn: false`), so the cues move into
  their key once the binding exists and the refusal is logged once, until
  the cues are taken away. Before the binding each update costs one
  thrown and caught refusal.
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
  out of view (checked in the commit frame); a focus change standing them
  on the new station's matrix in the frame of the change; a null cue
  keeping them in their key, hidden, landing unseen, and holding while
  their station's content is in view; the breadcrumbs led to the
  beacon's shown place, and to the new focus's own place while the cues
  still stand in the old one's key (the change's frame, a null cue); a
  first cue before the binding moving into the key once it exists.
- `playwright-tests/visitor-walk-radar.spec.js` - the cues stand at the
  focus, move to the next one when it is found, and go with the session.
