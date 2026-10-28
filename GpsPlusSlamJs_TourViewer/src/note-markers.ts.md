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
- `noteOpacity(facing)` - 1 for a note facing the camera (cosine above
  0.25), fading to 0.22 as it turns away; NaN gives the floor.
- `notesOnScreen(handles, camera, { width, height })` - every note of every
  handle projected: surface and marker in pixels, `behind`, `facing`
  (cosine of its normal against the view direction) and its distance.
- `layoutNoteMarkers(notes, screen, openKey)` - each disc's place: pushed
  apart toward the minimum gap where it can (six rounds; a crowd may stay
  closer), leaders kept on the true surface
  points; hidden when behind the camera, not finite or more than a disc
  off the screen; the title goes to the open note, else to the facing
  note nearest `(w/2, 0.45 h)` within 16 m.
- `createNoteMarkers({ layer, leaders }, onOpen)` -> `{ sync(handles,
camera, openKey), clear() }`. `sync` keeps one `button.note-marker`
  (with `.note-disc` and `.note-label`, classes `open` / `labelled`) and
  one SVG leader group per note, removes those of models gone, hides all
  without a camera, and eases each disc's opacity. A click calls
  `onOpen(handle, index)`.

## Invariants

- Only views that show notes (`hotspots`) are passed in by the caller.
- The layer's own size (`clientWidth` / `clientHeight`) is the screen.
- A shown disc is always within the screen plus `NOTE_EDGE_SLACK_PX`
  (20 px): "shown" is decided before the push, so a disc the push would
  carry past that edge is held at it. Two notes with room around them
  end at least `NOTE_MIN_GAP_PX` apart; a lone note is never moved.
- No occlusion test: a note behind the model's own body is faded by its
  facing, not hidden.

## Tests

`note-markers.test.ts` (jsdom): the fade and its floor, the push-apart,
the one title, hiding off-screen notes, the projection and facing, and the
buttons' lifecycle. `note-markers.property.test.ts` (fast-check): every
shown disc within the screen plus its slack, none behind the camera,
leaders' feet kept, a lone note unmoved, two close notes parted by the
full gap.
