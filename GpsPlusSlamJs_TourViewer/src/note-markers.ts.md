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
  block's `sizeM`, so the point's own surface, or an authored point a
  little inside it, never counts as a cover. Objects whose `raycast` is a
  no-op (the model's contact shadow) never cover. One module-level
  raycaster, hit list and direction are reused: no allocation per test.
- `notesOnScreen(handles, camera, { width, height }, cover?)` - every note
  of every handle projected: surface and marker in pixels, `behind`,
  `facing` (cosine of its normal against the view direction), its
  distance and `occluded` (from `cover`, by default `noteHidden` now).
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
  `NOTE_OCCLUSION_INTERVAL_S` (0.25 s; its age grows by `dtS`), because
  the ray walks the model's triangles; between tests the last answer
  holds and the disc's easing carries the change.

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
  ray per note, fine for the few notes a model carries, not for fifty.

## Tests

`note-markers.test.ts` (jsdom): the fade and its floor, the push-apart,
the one title, hiding off-screen notes, the projection and facing, the
cover test (a back note, a facing note behind another part, the slack
swept), its once-per-interval throttle, and the buttons' lifecycle. `note-markers.property.test.ts` (fast-check): every
shown disc wholly on the screen (tappable), none behind the camera,
leaders' feet kept, a lone note on the screen unmoved, two close notes parted by the
full gap.
