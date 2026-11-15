# note-markers.ts

## Purpose

A model's notes on the screen: one round disc per note on the AR overlay,
a leader line to the point it names, and one title at a time. DOM buttons
rather than 3D sprites, so a tap on one is an overlay tap and never an AR
select.

## Public API

- `noteKey(blockId, index)` - `"<blockId>#<index>"`.
- `NOTE_MIN_GAP_PX` (46), `NOTE_MIN_OPACITY` (0.22). With no card open, the
  note nearest the centre carries its label only within 16 m
  (`NOTE_LABEL_RANGE_M`, module-private).
- `noteOpacity(facing, occluded = false)` - 1 for a note facing the camera
  (cosine 0.3 or more), easing down (a smoothstep from 0.3 to -0.2) to the
  0.22 floor as it turns away; NaN gives the floor. An `occluded` note is
  multiplied by `NOTE_OCCLUDED_DIM` (0.45, the chosen page's), still never
  below the floor. (0.25 is a different threshold: the facing a note needs
  to carry the automatic label.)
- `noteHidden(model, eye, surface, slackM)` - the cover test: a ray from
  the eye toward the note's surface point meets `model` (recursively) more
  than `slackM` short of the point. The slack is
  `NOTE_OCCLUSION_SLACK_SHARE` (2 %, swept 0.5-5 % in the tests) of the
  model's size as drawn (`handle.drawnSizeM()`, world metres, so a folder
  that scales the model scales the slack with it), so the point's own surface, or an authored point a
  little inside it, never counts as a cover. Objects whose `raycast` is a
  no-op (the model's contact shadow) never cover. One module-level
  raycaster, hit list and direction are reused: no allocation per test.
- `coverTargetOf(model)` - what the cover ray is cast against: the model
  up to `NOTE_COVER_MAX_TRIANGLES` (30 000, counted from the index, else
  the positions, over every mesh), else the coarsest level of its first
  `THREE.LOD` when that level is at or under the cap, else null: no ray,
  the note reads as not occluded and only the facing fade dims it.
  Decided once per model (a `WeakMap`), since a mounted model's meshes do
  not change.
- `notesOnScreen(handles, camera, { width, height }, cover?)` - every note
  of every handle projected: surface and marker in pixels, `behind`,
  `facing` (cosine of its normal against the view direction), its
  distance and `occluded` (from `cover`, by default `noteHidden` now).
  `cover` is asked only for a note whose disc can be shown: in front of
  the camera and on the screen with the edge slack; any other note is
  not occluded and casts no ray.
- `layoutNoteMarkers(notes, screen, openKey)` - each disc's place: pushed
  apart toward the minimum gap where it can (six rounds; a crowd may stay
  closer), leaders kept on the true surface
  points; hidden when behind the camera, not finite or more than a disc
  off the screen; the title goes to the open note, else to the facing,
  not occluded note nearest `(w/2, 0.45 h)` within 16 m.
- `createNoteMarkers({ layer, leaders }, onOpen)` -> `{ sync(handles,
camera, openKey, dtS), clear() }`. Each disc eases toward its opacity
  by `dtS` (a quarter of the gap per frame at 60 Hz, the same per second at
  any frame rate; a first or non-finite `dtS` moves nothing). `sync` keeps one `button.note-marker`
  (with `.note-disc` and `.note-label`, classes `open` / `labelled`) and
  one SVG leader group per note, removes those of models gone, hides all
  without a camera, and eases each disc's opacity. A click calls
  `onOpen(handle, index)`. Each note's cover is tested at most once per
  `NOTE_OCCLUSION_INTERVAL_S` (0.25 s, on a clock that sums `dtS`), and
  a frame casts at most `NOTE_COVER_TESTS_PER_FRAME` (1) rays, because
  the ray walks the model's triangles with no acceleration structure. A
  due note left over this frame is remembered, the longest-waiting one,
  and goes first in the next, so every note is reached in turn whatever
  its order; a new note waits for its turn and reads as seen until then.
  Between tests the last answer holds and the disc's easing carries the
  change.

## Invariants

- Only views that show notes (`hotspots`) are passed in by the caller.
- The layer's own size (`clientWidth` / `clientHeight`) is the screen.
- A shown disc lies wholly on the screen, so it can be tapped: its centre
  is held `NOTE_DISC_RADIUS_PX` (14 px, the 28 px button) inside every
  edge. `NOTE_EDGE_SLACK_PX` (20 px) decides only whether a disc is shown
  (a marker that far past an edge still is, pulled in); it is decided
  before the push, and a disc the push would carry past an edge is held
  there too. Two notes with room around them end at least
  `NOTE_MIN_GAP_PX` apart; a lone note whose disc is on the screen is
  never moved.
- A note behind the model's own body is dimmed (the cover test), never
  hidden: the visitor still sees there is a note there. The test is a CPU
  ray against every triangle of its target, one a frame, so with n notes
  shown each is refreshed about every max(0.25 s, n frames).
- **Open: the cap is not measured on a phone.** 30 000 triangles is a
  guess at what one ray may cost in a frame on a mid-range Android phone;
  a measurement there (a ray's time against triangle counts) should set
  it, and may call for a bounding-volume tree instead of the cap.

## Tests

`note-markers.test.ts` (jsdom): the fade and its floor, the push-apart,
the one title, hiding off-screen notes, the projection and facing, the
cover test (a back note, a facing note behind another part, the slack
swept, a property over any eye: the entry point of a box seen, its exit
hidden), the slack under a scaled folder, the triangle cap on both sides
(the model, its coarsest level, no ray; an indexed mesh counted by its
index), a note over the cap left to the facing fade, the one-ray-a-frame
spread that reaches every note (2, 5 and 20 notes), no ray for a note
behind the camera or off the screen, and the buttons' lifecycle. `note-markers.property.test.ts` (fast-check): every
shown disc wholly on the screen (tappable), none behind the camera,
leaders' feet kept, a lone note on the screen unmoved, two close notes parted by the
full gap.
