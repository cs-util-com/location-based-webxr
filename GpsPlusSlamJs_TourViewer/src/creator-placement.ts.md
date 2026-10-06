# creator-placement.ts

## Purpose

Placing a pin or a photo in AR (guided-setup plan M4, DEC-N9): the gate a
placement needs, the pin's label input, the photo's capture, and the
troubleshooting recording's record of each placement. Split out of
`creator-setup.ts` unchanged in the code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`).

## Public API

- `wireCreatorPlacement({ ctx, arStore, arController, seams, dom, alignmentPicks, draft, previews, alignmentInfo, settledVisit, lateArrival, render }): CreatorPlacement`
  - `dom` (`CreatorPlacementDom`): `pinButton`, `pinLabel`, `pinSave`,
    `pinCancel`, `photoButton`, whose clicks this module handles.
  - `seams`: `getArWorldGroup` (the odometry frame a placement is kept
    in), `encodeFrameJpeg` (the photo's bytes).
  - `settledVisit(visit)` - the settle record of a visit that already
    settled; `lateArrival(visit, photo)` logs a photo minted through it as
    that settle's late arrival (`creator-settle.ts` owns the settle).
- `CreatorPlacement`:
  - `allowed()` - the gate below, re-checked at every tap; the object
    list asks it too.
  - `renderButtons()` - the pin and photo buttons enabled by the gate (the
    photo also needs a frame); the label input hidden when closed.
  - `countLine()` - " · N objects placed" for the readout: only objects
    the zip does not carry (an edit of a hosted object is not a placement),
    or "" with none.

## Invariants & assumptions

- **The gate:** allowed only under the mint gate's own
  alignment floor for THIS session (a measured code, a matrix and at least
  `MIN_ALIGNMENT_SAMPLES` fixes since the session started - a level that
  survived a session end does not open it, M4 review #2), a running
  session and no rebuild in flight; re-checked at every tap. "Place a pin
  here" reads the hit-test reticle (a surface must be under it, else the
  panel says so), opens the overlay label input (with a Cancel), and Save
  mints a `pin` record from the reticle's GPS-world position
  (`content-placement.ts`; the reticle rides the lerped visual alignment,
  which converges within ~0.3 s of a correction - the one frame difference
  to the photo's target-matrix mint, accepted);
  "Capture a photo here" encodes the latest camera frame's pixels
  (`ctx.latestFrame.image`) through `seams.encodeFrameJpeg` and mints a
  `photo` record from THAT frame's raw capture pose
  (`ctx.latestFrame.cameraPose`) through the session alignment, keeping the
  JPEG for the rebuild. The photo and its placement therefore describe the
  same moment; the pose used to be read at tap time (QR perf plan 2026-09-23
  M4). A frame older than `PHOTO_FRAME_MAX_AGE_MS` (1 s) is refused -
  `photo-frame.ts`, because frames stop during a tracking loss while
  `latestFrame` keeps the last one. Each placement renders its own preview (`renderTourObjects`;
  `ctx.placedPreviews`, one handle per object, so two placements cannot
  race each other's disposal and a photo is decoded once). A preview of an
  object placed in the RUNNING visit is rigid (decision D2, plan §3.2, M2c):
  it goes under the AR world group at its odometry pose, kept in
  `placedObjects[i].placement` (`{ visit, local }`; a pin's reticle through
  `worldToLocal`, a photo's capture pose through `odomNueFromWebXr`), so a
  GPS re-solve moves it together with the camera instead of sliding it
  against the world (symptom A). Anything else - a restored draft object,
  an earlier visit's - has only its geo and is placed from it.
- **A photo whose visit settled while it encoded** (its session ended, or
  a Finish ran) is minted through that visit's recorded alignment and zero,
  not the store's, which may already belong to no visit; it is then
  settled, and logged as the settle's late arrival. Its pick opens at the
  capture, not when the encode lands (D33).
- **The troubleshooting recording's record** (`tourAuthoring/objectPlaced`):
  dispatched from the tap's own handler, with the raw inputs - the reticle
  in the world group's frame for a pin, the frame's capture pose for a
  photo, the store's alignment, the group's matrix, the code last in view
  (read with `last`, never re-evaluated) and its printed size.
- Every outcome is `ctx.placementNote` (see `creator-setup.ts.md`).

## Tests

Composed, through `wireCreatorSetup`: `authoring-settle.test.ts` (pins and
photos placed rigid, the late-arriving photo, the gate),
`authoring-recording.test.ts` (the placement's record) and the e2e
placement specs. The sampled mutants that touch placement
(`scripts/fixtures/creator-setup.mutants.json`) are killed.
