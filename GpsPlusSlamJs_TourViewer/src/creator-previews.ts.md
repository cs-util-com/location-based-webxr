# creator-previews.ts

## Purpose

The creator's previews of the tour's objects in AR: each object rendered by
id, rigid when placed in the running visit and from geo otherwise, inside
the earlier visits' frame that a sighting of the code moves; and the bytes
of photos a Finish took out of the placed list. Split out of
`creator-setup.ts` unchanged in the code book refactor plan's M2
(`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`),
with the photo decoder injectable so a node test can see which bytes a
photo is decoded from.

## Public API

- `wireCreatorPreviews({ ctx, arStore, seams, creator, objects, selected?, viewHeightPx?, decodePhoto?, drawings? }): CreatorPreviews`
  - `seams`: `getScene`, `getArWorldGroup`, `createLabel`, `getViewerCamera`
    (what `tick` frames from), `loadGlbModel` (the door's model reader),
    `enableClipping` (a cutaway model).
  - `objects()` - the tour's objects now (`object-editing.ts`'s
    `objects`: the manifest's, this device's replacing them by id).
  - `selected()` - the selected item's id (`object-editing.ts`), handed to
    each part's frame (a character shows his bubble while selected).
  - `viewHeightPx()` - the view's height in CSS px for the camera's lens;
    the window's unless a test injects one.
  - `decodePhoto` - `decodeFrameTexture` unless a test injects one.
  - `drawings` (`CreatorPreviewDrawings`: `worldPart(block, env)`,
    `makeLectern`, `makeReadingSign`) - the page's own (`worldPartOf` of
    `play-kinds.ts`, `mountLectern`, `mountReadingSign` without a tap)
    unless a node test injects them (node has no canvas).
- `CreatorPreviews`:
  - `sync()` - bring `ctx.placedPreviews` in line with `objects()`. A
    no-op for a visitor or before the scene exists.
  - `waitingForZero()` - the last sync found no zero; the store
    subscription in `creator-setup.ts` syncs again once it lands.
  - `beginVisit(scene)` / `endVisit()` - a fresh earlier-visits frame at
    the scene root and every preview rendered afresh; at the end, what the
    previews were made from and the frame go (the previews themselves are
    disposed by the entry's teardown, `placedPreviews`).
  - `inVisit()` - the frame exists (the refusal re-judge reads it).
  - `placeEarlier(frames)` (code book plan M5b) - one frame per code this
    visit sighted with an accepted correction (`EarlierCodeFrame`: its
    corrected alignment and stored geo), under the world group with the
    alignment's inverse. Each earlier object is drawn in the frame of the
    code nearest it horizontally (`horizontalM`, no reach limit: with one
    code every object stays in its frame, as before); with none, from geo
    in the plain frame at the scene root. A code MEASURED in this visit is
    a plain anchor: its nearest objects are drawn from geo (M5b review #2).
    A changed assignment MOVES the rendered object into its new frame -
    never a new render (M5b review #3: a re-render blinked every object
    and decoded every hosted photo again); a preview still rendering is
    attached to its frame when it lands. A code no longer listed loses its
    frame, after its objects moved out; frames are removed through the
    node they were added to.
  - `tick(nowMs)` - one frame of every drawn world part that takes one,
    through `tickEachWorldPart` (`world-part.ts`, the visitor's own frame
    builder): the viewer camera, its lens over `viewHeightPx()`, the
    selection. Called from `creator-setup.ts`'s `tickStations` (each camera
    frame and store dispatch of a creator's session). No camera, a
    visitor, or no part: nothing. A part with no parent (a failed load took
    it out) is skipped.
  - `keepFinishedPhoto(id, blob)`, `reset()` - a finished photo's bytes,
    kept until the tour closes; `reset` disposes every preview and forgets
    them.

## Invariants & assumptions

- **Every free kind is drawn, as the desktop editor draws it.** A preview
  draws one authoring object (`TourObject`) through `renderTourObjects`
  with the world door in the edit mode (`worldEnv("edit", ...)`): a pin
  as the visitor's head on a stem, a sign, an edge hint, a ground arrow,
  a model (read by `seams.loadGlbModel`), a framed, cut-out or viewpoint
  picture, a video (still and silent), a sound (its icon and range ring,
  silent) and a character (his figure; the bubble while selected). A
  plane picture stays the photo plane (this device's bytes first); a long
  text gets its reading stand or reading sign. A tap selects any of them
  by the unchanged pick on the preview's root; a delete in the AR list
  disposes the preview and so its parts. Stories and quizzes are not free
  items and are not drawn here.
- **The door's files:** the tour's assets (`tourDocument.manifest()`) plus
  the object's own picture asset; the object's own picture is read from
  this device's bytes first (a picture placed here is in no zip yet),
  every other file through the session (`loadContentEntry`). A file the
  tour lacks rejects, and the part takes itself out (`ready`).
- **The parts that take a frame** are kept in a side table by object id
  (three.js objects, outside the store), dropped with their preview (a
  stale key, a delete, a clear, a visit's end, a tour's close). `tick`
  walks one live set, no copy per frame; the visitor's per-frame tick
  (`tickWorldParts`) frames only parts under a station's content group,
  so a preview is never framed twice.
- **Where a preview goes** (decision D2, plan §3.2, M2c): an object placed
  in THIS visit is rigid in AR, under the world group at its odometry pose;
  anything else has only its geo and is placed from it in the earlier
  visits' frame (the scene root outside a visit).
- **Incremental, by id** (`previewKey`: the whole object - any field may
  be part of its look now that every kind is drawn, a view, a size, a
  clip - and the local pose when rigid): a preview whose object changed
  look or pose is replaced, one
  whose object is gone is disposed, the rest are left alone, so each
  placement decodes only its own photo and two placements cannot race each
  other's disposal. A render that lands after its visit ended, or after its
  object changed, is disposed; a throwing label or plane forgets its key so
  a later sync retries.
- **A photo's bytes:** this device's first (the placement's blob, or the
  bytes a Finish kept), else the hosted zip's through the session
  (`loadContentEntry`), decoded under the tour pixel cap
  (`TOUR_MAX_IMAGE_PIXELS`, tour kit K4 review R2). A Finish takes a photo
  out of the page's entries while the hosted zip lacks its bytes until the
  upload, which is why it hands them here.
- **A preview from geo waits for the zero** (M2c review #4): on the
  first visit of a page load (a restored draft) the zero arrives with the
  first GPS fix, after `beginAuthorVisit` ran. `sync` notes that it
  found no zero, and the store subscription syncs again once the zero is
  there; the note is cleared at the visit's end.

## Tests

- `creator-previews.test.ts` - which bytes a photo preview is decoded
  from (the kept ones, else the zip's; forgotten on a tour close), with the
  decoder injected.
- `creator-previews.test.ts` "every kind through the world door" (the door
  mocked at its boundary): every free kind drawn under its root by id;
  the edit mode, the page's model reader and this device's bytes first; a
  delete disposes and unmounts; `tick` hands the camera, lens, viewer and
  selection, skips a detached or deleted part, and ticks nothing without
  a camera or after the visit.
- e2e `object-editing.spec.js` "in AR the creator sees every kind of item
  drawn...": the blocks tour's every free item in the fake scene, a tap
  selects the model, Delete takes it out.
- Composed: `creator-finish.test.ts` "a finished photo keeps its bytes for
  its preview" (the Finish's hand-over), `authoring-settle.test.ts` (rigid
  previews, the earlier visits' frame, the wait for the zero), and the
  e2e authoring specs.
- The sampled mutants of the region "previews"
  (`scripts/fixtures/creator-setup.mutants.json`) are killed.
