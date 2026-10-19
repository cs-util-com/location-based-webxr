# creator-placement.ts

## Purpose

Placing a pin or a photo in AR (guided-setup plan M4, DEC-N9): the gate a
placement needs, the pin's label input, the photo's capture, and the
troubleshooting recording's record of each placement. Split out of
`creator-setup.ts` unchanged in the code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`).

## Public API

- `wireCreatorPlacement({ ctx, arStore, arController, seams, dom, alignmentPicks, draft, previews, alignmentInfo, sizeOf, settledVisit, lateArrival, stationOf?, render }): CreatorPlacement`
  - `dom` (`CreatorPlacementDom`): `pinButton`, `pinLabel`, `pinSave`,
    `pinCancel`, `photoButton`, `newStationButton?` ("New station
    here", D8, below), whose clicks this module handles.
  - `seams`: `getArWorldGroup` (the odometry frame a placement is kept
    in), `encodeFrameJpeg` (the photo's bytes).
  - `settledVisit(visit)` - the settle record of a visit that already
    settled; `lateArrival(visit, photo)` logs a photo minted through it as
    that settle's late arrival (`creator-settle.ts` owns the settle).
  - `stationOf(id)` (optional, tour editor plan 2026-10-17-1816 W3 "AR
    authoring") - where the just-placed object went among the stations,
    as `creator-stations.ts` words it ("it starts Station 2", "in
    Station 1"), or null. The pin's and the photo's note carry it after
    "placed" (`Pin "Gate" placed - in Station 1 · ...`); absent or null,
    the note names no station.
  - `stationNameOf(id)` (optional, D8) - the name of the station the
    object is in ("Station 2", `creator-stations.ts` `nameOf`), for a
    "New station here" placement's note.
- `CreatorPlacement`:
  - `allowed()` - the gate below, re-checked at every tap; the object
    list asks it too.
  - `renderButtons()` - the pin and photo buttons enabled by the gate (the
    photo also needs a frame); the label input hidden when closed. In
    object mode (`deps.objectSelected()`, polish round M3, B5) both are
    hidden and an open label input closes: the selected object's own
    actions take their place.
  - `countLine()` - " · N objects placed" for the readout: only objects
    the zip does not carry (an edit of a hosted object is not a placement),
    or "" with none.

## Invariants & assumptions

- **The gate:** allowed only under THIS session's GPS alignment (a
  matrix and at least `MIN_ALIGNMENT_SAMPLES` fixes since the session
  started, M4 review #2), a running session and no rebuild in flight;
  re-checked at every tap.
- **Never a code** (field test 2, F5; owner, 2026-10-09): placing an
  object is GPS and tracking only, so a tour builder with no codes places
  exactly as this one does, and the module has no access to the codes. The
  gate used to need a measured code too: adopting a new print size
  mid-walk emptied the hand and greyed the buttons for the rest of the
  loop. An object placed with no code in the visit is settled through the
  visit's own alignment (`visit-settle.ts`, basis `visit-alignment`). "Place a pin
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
  JPEG for the rebuild. One photo is in flight at a time: its button
  stays disabled from the tap until the encode lands or fails, through
  every render meanwhile (`capturing`; the "Capturing…" note used to
  re-render it enabled at once). The photo and its placement therefore describe the
  same moment; the pose used to be read at tap time (QR perf plan 2026-09-23
  M4). A frame older than `PHOTO_FRAME_MAX_AGE_MS` (1 s) is refused -
  `photo-frame.ts`, because frames stop during a tracking loss while
  `latestFrame` keeps the last one. Each placement renders its own preview (`renderTourObjects`;
  `ctx.placedPreviews`, one handle per object, so two placements cannot
  race each other's disposal and a photo is decoded once). A preview of an
  object placed in the RUNNING visit is rigid (decision D2, plan §3.2, M2c):
  it goes under the AR world group at its odometry pose, kept beside the
  document as the entry's `placement` (`{ visit, local }`,
  `creator-document.ts`; a pin's reticle through
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
  dispatched from the tap's own handler, with the object as the document
  took it (naming its own station after "New station here", D8) and the
  raw inputs - the reticle
  in the world group's frame for a pin, the frame's capture pose for a
  photo, the store's alignment, the group's matrix, the code last in view
  (read with `last`, never re-evaluated) and its printed size.
- Every outcome is `ctx.placementNote` (see `creator-setup.ts.md`).
- **"New station here"** (owner decision D8 of `GpsPlusSlamJs_Docs/docs/2026-10-18-2210-editor3d-prototypes-round-2-plan.md`, phone half):
  places closer than about 40 m cannot be separated by any automatic
  radius, so the chip makes the NEXT placed item start its own station,
  anchored where it is placed, even within R of another. Decisions
  inferred from the existing chips and rules (r886):
  - **A toggle, and its state is the document's**: a tap arms it, a second
    tap disarms it; the flag is the `tourDocument` slice's
    `newStationArmed` (`ctx.tourDocument.armNewStation`), never module
    scope. `aria-pressed` shows it (the page draws an accent ring), and
    the station line says "What you place next starts a new station here."
    while it is armed (`creator-stations.ts`). Arming says "The next pin
    or photo starts a new station here." in the note; disarming clears it.
  - **Taken when the item is committed, and handed to the document**
    (`ownStation` of `CreatorDocument.place`): a pin at Save, a photo
    at its SHUTTER TAP - not when its encode lands, which is async (r886
    review M4): read then, the arm missed a photo whose visit ended
    meanwhile (the visit's end disarms) and went to a photo shot before
    the creator armed. One arm therefore starts one station: the chip
    shows it taken during the encode, and an arm set meanwhile is for the
    NEXT item. An item that is not placed gives it back, so the creator
    can try again: a failed encode, no usable alignment, or a refusal by
    the document's guard - but only into the visit it was taken in (a
    visit that ended disarmed it for good). Checks that fail before the
    commit never take it: no text typed, the label input cancelled, no
    surface under the ring, no GPS fix, no camera frame.
  - **The late arrival is logged with the photo as the document took
    it** (naming its own station). The settle's log records each object's
    id and geo only, so the station itself is not in that record.
  - **The result is said in the placement note**, the phone creator's one
    channel for every placement outcome (the invariant above), not a
    separate toast: `Pin "Gate" placed - New station started: Station 2 ·
2 objects placed.` (the station named as `placedIn` would, hedged
    while the walk's photos are pending).
  - **It looks and steps aside like the other chips**: the photo chip's
    dark pill, the same gate (disabled when a placement is not allowed),
    hidden in object mode and while a pin's text is typed, its label
    folding to its icon after its first use (`folding-label.ts`). The
    strip wraps upwards on a phone, where three labels do not fit one row
    (the page's CSS): the pin and the photo stay at the bottom, the
    station chip goes above them.
  - **Disarmed at the end of an AR visit** (`creator-setup.ts`) and when
    a tour opens or closes (the slice's initial state); an undo of the
    placement takes its station away and does not re-arm.
  - Not built here: the desktop half (the tree's "+", the inspector's
    "Move to a new station") comes with the 3D editor;
    `tour-document-parity.test.ts` carries it as a by-design row.

## Tests

Composed, through `wireCreatorSetup`: `authoring-settle.test.ts` (pins and
photos placed rigid, the late-arriving photo, the gate),
`creator-setup.test.ts` ("New station here": the armed state and a second
tap, a pin within R starting its own station with the note, the one-shot,
the arm kept when nothing was placed, the undo, the visit's end),
`authoring-settle.test.ts` ("New station here" and a photo: the arm taken
at the shutter tap, a visit ended during the encode, an arm set during
"Capturing...", the arm given back after a failed encode but not into an
ended visit),
`playwright-tests/creator-stations.spec.js` (the same through the page and
the written tour),
`authoring-recording.test.ts` (the placement's record) and the e2e
placement specs. The sampled mutants that touch placement
(`scripts/fixtures/creator-setup.mutants.json`) are killed.
