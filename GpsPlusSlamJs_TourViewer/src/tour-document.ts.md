# tour-document.ts

**Purpose:** the ONE Redux slice for the tour a creator edits (decisions
D29-D31 of the tour editor plan, and the root rule "App state lives in the
Redux store"): the tour as opened and as last written, the edits not yet
written, the station frames, the tour-level setting and details, an undo
history over the whole document, and the save status. Shared by every
page that edits a tour: the desktop editor (`editor/editor-session.ts`)
today, the phone's creator in a later milestone. Mounted in the Tour
Viewer's store (`createTourViewerStore`, `tour-viewer-session.ts`) as
`tourDocument`; its actions are not written into the phone's recordings.

It lives at the top of `src/` so both pages may import it; the shared pure
rules it composes (`object-edits.ts`, `finish-rebuild.ts`,
`tour-content.ts`, `authoring-draft.ts`, `tour-details-form.ts`) are its
reducers' building blocks, so a page cannot apply them differently.

## State (`TourDocumentState`)

- `generation` - counts the opens; a late answer (a save of a tour closed
  meanwhile) names the generation it began on and is ignored for another.
- `opened`, `written` - the tour as opened, and as last written (the
  opened one until a save landed); null before an open.
- `stations: StationFrame[]` - every station without its items (`geo`,
  radii, title, steps): the frames as they stand, moved by `stationMoved`,
  started by the station rule (below) and dropped with the last object of
  an automatic one, in the order they were made.
- `placed: EditEntry[]` - objects placed, edited or moved, in the world,
  one entry per id; pending while the written file, read through the
  document's frames, does not hold them by content (`unsavedEntries`): a
  station's rigid move leaves its items unchanged inside it, so only the
  frame is pending.
- `deleted: string[]` - ids of written objects deleted and not yet written.
- `needsNoGps`, `details` (`TourDetailFields`) - the setting and the details
  as set; `touched` says which were changed here since the open (live work,
  which a draft's offer never overrides - `touched.stations` for a station
  moved here); `detailsRecorded` and `stationsRecorded` say the draft's
  settings record carries the details, and the station poses (`StationPose`,
  `{ id, geo }`: set by a station move or by an open whose frames moved,
  review #1 of the tour document milestone - without them a reload after a
  station move restored its items under the file's frame, so they landed
  elsewhere).
- `framesRecorded` - the draft's settings record carries the stations
  edited beyond their pose or added here, whole (`frames`,
  `recordedFrames`), their order when a restore needs it (`order`,
  `recordedOrder`) and the written stations gone since the open
  (`deletedStations`): set by a station's edit, add, delete, reorder or
  copy, by a step whose frames differ beyond a pose, and by a restore that
  brought any of them back.
- `deletedStations: string[]` - written stations a station's delete
  removed. A written station no frame names otherwise follows the frames
  when it is bare (`withFrames`, below), so without this list a deleted
  bare station would come back as one its items left. Kept in each view
  (absent when empty), so an undo of the delete brings the station back;
  a landed save drops the ids the write left out.
- `past` / `future: TourHistoryStep[]` - the history: each step a
  `TourDocumentView` (`stations`, the world `objects`, `needsNoGps`,
  `details`, `deletedStations` when any) and the edit in words. At most
  `TOUR_HISTORY_LIMIT` (200).
- `revision` - counts every edit, undo and redo.
- `position` - where the document stands in its history: 0 at the open,
  one more for an edit or a redo, one less for an undo. Absolute (the
  history's bound drops old steps, never renumbers them), so a save names
  the view it wrote (`save.inPlaceAt`).
- `save: TourSaveStatus` - what used to be the desktop page's module-scope
  save flags: `status` (`idle` / `saving` / `error`, derived: saving while
  the page's slot is held or a rebuild runs), `error` (the last failure's
  words), `by` (who holds the page's one save slot: `explicit`, `auto`,
  `walk`), `rebuilds` (the session's queued rebuilds: an undo waits),
  `queued` (a Save waiting for the autosave), `built`, `delivered`
  (in place or downloaded, under which name), `largeTour`, `cannotSave`,
  `inPlaceAt` and `resave` (D33, below).

- `newStationArmed` - the phone's "New station here" is armed: the
  next placement starts its own station. An
  authoring flag of the page, kept here because this is the slice that
  holds the page's authoring state (the save slot too); `tourAuthoring/*`
  has no reducer by design. Not an edit: no history, no revision, no draft
  write. The initial state, so `opened` and `closed` disarm it. The
  phone's handle mints the station id and consumes the flag
  (`creator-document.ts`).

- `codes` - the tour's codes (debug-captures plan M3a): `book`, every
  code this page took in the order it took them (`code-book.ts`'s
  `TourCode`: saved text, hosted text from the first Finish on, the
  measurement per code, what the last Finish wrote), and `hosted`, the
  open tour's level files `{ session, texts, unreadable }` held per open
  (`session` is the page's open counter). No history step, no draft write,
  and NOT reset by `opened` or `closed`: the phone reads `tour.json` and
  the levels concurrently, so either may land first. The code in hand and
  the visit's sightings are the page's, in `creatorCodes`
  (`creator-codes-slice.ts`).

Blobs are never state: a photo's picture lives in the page's side table
keyed by id (`editor-session.ts` `pictures`), handed to the draft by the
listener (`tour-document-draft.ts`) and to the rebuild by the page.

## Actions (`tourDocumentActions`)

- `opened({ manifest, newTourId? })` - everything before it is gone;
  `generation` + 1. A tour without an id of its own takes `newTourId` into
  `written` (debug-captures plan, Q-I): minted by the page that opens it
  (`newTourId()` of `tour-file-key.ts`; a reducer draws no random
  numbers), so every write carries it; `opened` stays the file's tour as
  read, and the id reads as no change. A tour's own id is never replaced.
  An earlier file's debug camera captures (`captureSpots`) never reach
  it: the format no longer has the field and the reader ignores it, so
  the document opens the file's stations as written.
  Only who holds the page's save slot (`save.by`) is kept: the slot is
  the page's, and the save holding it lets it go once it sees its tour
  gone (as the page's own flag behaved).
- `placed` / `edited` / `moved({ object, what, newStationId?, newStation? })`
  - one entry per id (`upsertPlaced`): a new object, a pin's text, a move
    on the map or in AR. Three names so a log reads as what happened. None
    changes anything for a pending object put again with the same content
    and the same stations (`objectContentKey`): the AR settle re-poses
    every object of a visit, and an unchanged one is no step - it would
    withdraw a delete's Undo.
- **Every object belongs to a station from the moment it is placed** (the
  station rule, `seatByRule`). It reads the stations of `manifestNow` (a
  written station no frame names still counts: seated in, it is listed
  back where it stood in the file, before the first frame the file lists
  after it - where a reload from the draft, which records no order for a
  move, puts it; appended after the others, the live order differed from
  the reload's) and seats an object naming
  no station in the NEAREST station whose OWN `foundRadiusM` holds it
  (`station-assign.ts` `stationHolding`: horizontal, the radius itself
  inside, a tie to the earlier station) and whose frame can carry it
  (`TOUR_ITEM_MAX_OFFSET_M` per axis: a found radius has no upper bound,
  so a 50 km radius never takes an object 20 km away), or starts a new automatic station
  anchored at it (`tour-content.ts` `automaticStationFrame`: found 25 m,
  activates 50 m, turned like north, arrow hint, no story), appended to
  `stations`. The new station's id is minted OUTSIDE the reducer: the
  caller passes `newStationId`, or the action's `prepare` mints one
  (`newObjectId`), so the reducer stays pure and a test can pin it; a
  taken id changes nothing.
  - `placed`: refused for an id the document carries or deleted (its
    tombstone would hide the placement), or naming a station it lacks or
    too far from it (`canPlace`). An object naming a station keeps it;
    one naming none is seated by the rule; "New station here"
    (`newStation: true`) always starts a new station, even within
    another's radius.
  - `edited`: keeps the object's station (`objectFits`); an object naming
    none, of an id the document lacks, changes nothing.
  - `moved`: within its station's own found radius (and the format's
    reach) the object keeps its station (whose anchor stays put); beyond
    it the rule runs again - the station holding the new spot, or a new
    one there - so no move is ever too far, and none is silently dropped.
    An object already outside its station's radius (the radius shrank,
    the station moved) keeps its station when moved no farther from the
    anchor and into no other station's radius (`keepsHome`); a station
    whose radius already held the old spot (overlapping radii) is not one
    it moved into, so a nudge toward its own anchor keeps it. The comparison is
    strict, so a move a centimetre farther out runs the rule. The station it left goes in the same step when that leaves
    it an EMPTY AUTOMATIC station: no object names it, and nothing of its
    own (`keepsItself` of `tour-content.ts`: a title, a story step, a
    non-blank description, a card image naming an image asset) and no
    route to it (`next`, a quiz's routes) keeps it. An unknown id changes nothing.
  - One step each: an undo gives the stations back exactly as they were.
- `deleted({ id, what })` - `deleteObject`: the entry goes, a written
  object gets a tombstone, and its station goes too when that leaves it an
  empty automatic station (as for a move); an unknown id changes nothing.
  "Written" is the file's view: an object moved out of a station that was
  then deleted is still in the file (in that station's items), so its
  delete gets a tombstone too - the draft and the rebuild know a delete by
  its tombstone alone (without it a reload brought the object back with
  its station, and a save kept a photo's picture in the zip).
- `stationMoved({ stationId, geo, what })` - D17: the frame moves, and every
  object of the station becomes an edit at the spot the moved frame gives
  it (its local pose kept), as the phone's settle leaves its lists; an
  unknown station changes nothing.
- `settleApplied({ changes, codes, hand, what })` - a settle as ONE step
  (plan M3b, Q-D): `changes` (`SettleChange[]`, in the settle's order:
  `{ kind: "station", stationId, geo }` by `stationMoved`'s rule, `{ kind:
"object", object, newStationId }` by `moved`'s) applied one after the
  other, each reading the document as the ones before left it; then
  `codes` saved (`withSaved`) and the hand named after them winning
  (`withHand`). The step keeps each code whose saved text it changed with
  its earlier text (`TourHistoryStep.codes`), so its undo puts the text
  back and its redo the new one - only while the code still holds the
  text the step left (the codes take no step of their own: a code
  measured again since is newer work, and the step leaves it). No step
  when nothing moved and no saved text changed.
- `handReleased({ levelIds })` - no change of the document: the hand of
  `creatorCodes` lets go of a code an undo or a redo took the saved text
  of (`creator-codes.ts`'s listener dispatches it).
- `settingsChanged({ needsNoGps, what })`, `detailsChanged({ details, what })`
  - the details as checked by `checkDetailsForm`.
- `undone()` / `redone()` - one step (none while a save is queued or runs,
  `canStep`); the document goes to the step's view
  MEASURED AGAINST THE WRITTEN FILE (`contentAt`): what the file holds as
  the view has it is not pending, the rest is. "Holds" is read through the
  VIEW's frames, as `documentObjects` reads the objects: an item the file
  keeps at a local pose under a frame the view moved stands elsewhere, so it
  stays an entry (a save under a moved frame, then an undo of the move -
  found by the "undoing everything" property). The view's OBJECTS are part
  of that reading too: a station only a pending object of the view names
  (one the rule started) is in it, so an object the view seats there
  counts as moved, never as the file's copy in its old station - which
  would leave the view's station empty and the object in a station the
  frames lack (an undo across a save of a restore, a redo after a station
  move; found by the station-rule property). A save that lands after a
  frame moved prunes the same way. A step marks the station poses as the
  draft's to keep (`stationsRecorded`, `touched.stations`) only when a
  frame both views carry differs: a station the rule started or dropped
  is no moved station. A step that carries codes (a settle's) sets their
  saved texts too, under the rule of `settleApplied` above, and the step
  it leaves for the way back carries the codes it set.
- `restored({ objects, deleted, needsNoGps?, details?, stations?,
createdStations?, frames?, order?, deletedStations?, rerun?, what,
newStationIds? })` - a draft's work,
  already filtered by the page's rules, as one step to undo; not live work
  (`touched` unchanged). In order: the station poses (each named
  station's frame takes its pose, `stationsRecorded` set); the CREATED
  stations' whole frames the document lacks (a draft keeps them, so a
  reload brings a pin's station back with it); then each object - in its
  own station when the document carries it and it fits there, else seated
  by the station rule under its minted id (`newStationIds[i]`, one per
  object, minted by `prepare`). `rerun` (work carried into a tour just
  opened) seats every object afresh by the rule: the stations they named
  were another document's. The stations left emptied go as for a move.
  Then the stations edited, added, deleted or reordered there (`frames`,
  `order`, `deletedStations`, a draft that recorded a station's edit):
  each recorded frame replaces the document's frame of its id AT THE
  DOCUMENT'S POSE (the opened file's, or the poses' record's - a frame is
  recorded for an edit beyond its pose, so a file moved on another device
  keeps its move) or is added whole (one whose story steps name an asset
  the written tour lacks is skipped); each deleted station no restored
  object names goes (a written one joins `deletedStations`); every route
  to a station the tour no longer carries is pruned; and the stations
  follow the recorded `order`, those it does not name after them (no
  order: the opened file's, then the added ones). Stations the record does
  not name keep the opened file's version, title and all.
  A record without these fields (written before stations were kept
  whole) restores as before. Every frame a restore brings - recorded or
  created - is checked against the tour it is restored into: one whose
  story names an asset the tour lacks is left out (its objects are seated
  by the rule), and a route to a station the tour does not carry is
  pruned, since the format refuses both and every later save would fail.
- `saveStarted({ generation })`, `saved({ generation, written,
appliedDeletions, stationsAtStart, inPlaceAt? })`, `saveEnded({ generation, error? })`
  - a rebuild queued, landed (the written file replaced; `pendingAfterRebuild` keeps what the
    write did not carry; the written frames replace the document's unless one
    moved while it ran), and ended. Each names the open it began on and is
    ignored for another. `inPlaceAt` (the desktop's in-place write: the
    history position of the view the save's snapshot took) becomes
    `save.inPlaceAt`; without it (a download, the phone's Finish) that is
    null.
- The page's save slot (the desktop page, `editor/edit-main.ts`):
  `saveClaimed({ by })` (it also takes a due `resave` on: a save claimed
  after a step writes the document as it stands then, or says why it could
  not - so a refusal never loops), `saveReleased({ error? })`, `saveQueued({ queued })`,
  `saveBuilt()`, `saveDelivered({ inPlace, name })`, `saveLimited({
largeTour?, cannotSave? })`.
- The 3D editor's station edits, each ONE step (refused, changing nothing,
  before an open, for an unknown station or item, or for a value the
  format refuses - the page asks the exported guard first and says why):
  - `stationEdited({ stationId, edit, what })` - a station's title, found
    radius (`isStationRadius`, 2 m to 300 m inclusive; the preload radius
    follows at twice it, `preloadRadiusM`), description or card image
    (`StationEdit`; `image: null` clears it), by `stationEditChange`'s
    rules: a title of at most 80 characters (`checkTourTitle`, blank
    clears it), a description of at most 2000 (`checkTourDescription`),
    an image that is a photo of that station or an image asset. Any
    station the next write carries is edited, a written one no frame
    names (it follows its items until a write prunes it) too: it becomes
    one of the document's frames (`framesHolding`).
  - `stationAdded({ at, stationId?, what })` - an automatic station
    (`automaticStationFrame`) at a point on the globe, titled
    `Station N` after the stations it follows; `prepare` mints the id, a
    taken or malformed one changes nothing.
  - `stationDeleted({ stationId, what })` - the station with its items
    (each deleted as `deleted` does) and every route to it pruned
    (`withoutRoutesTo`: a `next`, each quiz target, a route left with no
    target); a written station joins `deletedStations`. The tour's last
    station is refused (`stationDeleteRefusal`: `missing` or `last`). The
    other stations stay listed as for a reorder (`framesToList`).
  - `stationsReordered({ order, what })` - a permutation of the stations
    `manifestNow` carries; anything else (or the same order) changes
    nothing. A written station no frame lists and nothing stands in any
    more (an emptied automatic one, which the next write leaves out) stays
    unlisted (`framesToList`, shared with `stationDeleted`): listed back
    as a frame, its place in the order put the items moved out of it
    ahead of their new station's own, where a reload from the draft puts
    them after. A delete of another station listed it back the same way
    until it shared the rule.
  - `stationDuplicated({ stationId, newStationId, newItemIds, createdAtIso,
geo?, what })` - a copy inserted after the original (any station the
    next write carries, as for `stationEdited`), titled `<title> copy`
    (the original's title shortened so the copy's fits 80 characters,
    `copyTitle`), its card image kept when it names an image asset and
    dropped when it names the original's photo (the copy holds another),
    at `duplicateStationGeo` (twice the found radius plus 5 m
    east, so the two preload rings never overlap) or `geo`; each item is
    copied under its new id at the same local pose (`rigidlyMoved`), a
    photo naming `content/<new id>.<ext>`. `prepare` mints the station id
    and the time; the page mints the items' ids (it copies their pictures
    first). An original the frames do not list back (`framesToList`: an
    emptied automatic station, which the next write leaves out) stays
    unlisted, and the copy takes its place in the shown order. It once
    listed the original back so the copy could stand after it; a later
    reorder then ordered the items moved out of it ahead of their new
    station's own, which a reload from the draft cannot give back
    (`tour-document-stations.test.ts`, "is edited and copied like any
    other station", pins the new rule).
  - `objectDuplicated({ id, newId?, createdAtIso?, what })` - an item's
    copy 1.5 m east (`duplicateItemGeo`) or at `geo`, same height and
    facing, in the same station; a copy its station cannot carry
    (`objectFits`) is refused, changing nothing - it is never re-seated.
  - `itemsGrounded({ items: [{ id, alt }], what })` - several items' new
    altitudes ("put on the ground", the page measures the ground) as one
    step; an unknown id refuses the whole step.
  - `modelResized({ id, sizeM, what })` - a placed model's size, within
    `TOUR_MODEL_MIN_SIZE_M`..`TOUR_MODEL_MAX_SIZE_M` (0.05 m to 500 m).
  - `moved` with `newStation: true` - "Move to a new station": the item
    starts a station of its own where it stands, even within its own
    station's radius.
- `newStationArmed({ armed })` - "New station here" armed or disarmed
  (D8); no edit.
- `closed()` - the tour is gone without another opening: back to the
  initial state, `generation` + 1, the save slot kept as for `opened`.

Names adjusted from the coordinator's list: `deleteUndone` is not an
action - an undo of a delete is `undone` (the whole document's history),
and the phone's toast-only undo is the phone adoption's decision; the
save is three actions because a write is queued, lands, and ends at
different times (a walk's move lands only after the page wrote both files).

- The codes (debug-captures plan M3a). Each change of the book names the
  code in hand after it (`hand`), whose text wins for its own code
  (`withHand`); `creatorCodes` takes the hand from the same action:
  - `codeTaken({ level, measurement })` - taken in hand (a measurement, or
    a kept reference with null; no level: the hand empties, the book stays);
  - `codeTakenFromDraft({ level })` - a draft's level into the empty hand,
    at the text the page gives (its live text where it has one);
  - `codeLetGo({ levelId })` - nothing in hand: that code's measurement
    goes and its text falls back to the zip's;
  - `codeMeasurementDropped({ levelId, hand })`, `codeSaved({ level, hand
})`, `codesRestored({ levels, hand })` (`withDraft`: live work wins,
    judged against the hosted texts as they stand), `codesFinished({
written, hand })` (the hosted texts enter the book);
  - `codesForgotten()` - a tour's close: the book goes;
  - `levelsArrived({ session, texts })`, `levelsUnreadable({ session })`,
    `levelsCleared({ session })` - the open `session`'s levels: arrived,
    unreadable (texts null), none yet. An older open's answer is dropped,
    a newer one's replaces them; either order with `opened` holds them.
  - `levelsParsed({ session, levels })` - the same open's levels as they
    parsed (`{ id, level }` in the zip's order; null: none), under the
    same session rule (plan M3b): the viewer's level source, the
    numbering's order and the hosted poses the codes read. A newer open
    starts with none; within one open the texts and the parse land in
    either order, each keeping the other.

## Selectors and pure rules

- `selectTourDocument(root)` - the slice in a store's state.
- The codes: `documentCodes(state)` (the book, in order),
  `codeSavedText(state, id)`, `codeLiveText(state, id)` (`liveText`
  against the hosted texts as they stand), `levelsToWrite(state)` and
  `levelsNotHosted(state)` (the two baselines kept apart: `finished ??
hosted` for a Finish, `hosted` for the draft), `hostedLevelTexts(state)`
  (a map, the same one until the levels change; null before they arrived
  or after a failed read), `hostedLevels(state)` (the parsed levels by id
  in the zip's order, the same map until they change; null before they
  arrived) and `hostedLevelsUnreadable(state)`.
- `documentObjects(state)` - the objects now (`authoringObjects` over the
  written tour with the frames), each with its entry; `hosted` is whether
  the written file holds the object, wherever the frames put it.
- `manifestNow(state)` - the manifest the next write starts from: the
  written tour with the frames (`withFrames`), each station's card image
  as shown and written (one whose picture is gone - a deleted or moved
  photo - is none, and comes back with an undo, as the cover does), the
  setting (`withNeedsNoGps`) and the details (`effectiveDetails`).
  `withFrames`' rule for a written station no frame names: it follows
  unless `deletedStations` names it - a bare one always (its items keep
  their home, and a write prunes it once they are gone), one that keeps
  itself (`keepsItself`) only while an object of the document still
  stands in it, so a station added, saved and undone is gone rather than
  kept by its own title. A frame the file lacks is kept while an edit
  names it, it keeps itself (a station added or copied here), or it is a
  bare empty station of the tour as opened (`bareEmptyStations`: nothing
  else would keep one, so its delete, saved, then undone, brought nothing
  back). Not for a bare empty station only a later write held (added,
  its title cleared, saved): its delete, saved and undone, stays gone.
- `stationImages(state)` (module-private) - the images each station's
  card may show, by station id: a photo of that station as the document
  holds it, or an image asset. One pass over the objects per call.
- `stationEditChange(state, id, edit)` - `edited` with the frame to
  dispatch, `unchanged`, `refused` with the field the format refuses
  (`title`, `radius`, `description`, `image`), or `missing`.
- `stationDeleteRefusal(state, id)` - `missing`, `last` (a tour keeps at
  least one station) or null.
- `documentFrames(state)` - every frame the next write carries, whole and
  in its order: what the record below is cut from.
- `recordedFrames(state)`, `recordedOrder(state)` and
  `stationsGoneSinceOpen(state)` - what the draft's settings record keeps
  when `framesRecorded`, measured against the tour as opened (a download
  leaves it on disk) and as last written (an in-place save): the frames
  either lacks or carries otherwise beyond their pose (`sameBeyondPose`),
  never one alike in both - a restore over a file changed elsewhere then
  keeps that file's version of every station not edited here; the ids of
  `documentFrames` in order, only when a restore without them would
  order the stations otherwise (a reorder, a copy inserted mid-tour);
  and the stations of either tour the next write no longer carries,
  except one a write dropped as an emptied automatic station (bare,
  holding items in every file that carries it, no delete of it pending):
  it follows its items, as it does while their deletes are unwritten, so
  the offer never calls it "a station deleted".
- `sameBeyondPose(a, b)` - two frames alike in every field but `geo`, by
  data whatever their key order (`same-json.ts`): what "edited beyond its
  pose" means here and in the desktop's draft offer.
- `stationEditsBetween(before, after)` - the station changes beyond poses
  from one state to another, counted as `changeCount` counts them: what a
  restore says it brought back.
- `manifestToWrite(state)` - what a write would carry:
  `finishedManifest` (the Finish's own rule) over `manifestNow`, `placed`,
  `deleted` and `historyAssetIds`.
- `historyAssetIds(state)` - the assets the undo and redo steps' views
  name (their frames' steps and card images, their objects - a placed
  model's file - and
  their covers). Every write
  keeps them (`keepAssets`: this selector, the desktop's save snapshot,
  the phone's Finish), so an undo across a save finds a cover image the
  save would otherwise have dropped with its file; they go once the
  history no longer names them. The stations are the document's as they
  are, and a write assigns nothing. The creator's station HUD (`creator-stations.ts`)
  reads its stations from it.
- `createdStationFrames(state)` - the frames of the stations this page
  created (those the tour as opened lacks): what the draft's settings
  record keeps whole (`tour-document-draft.ts`).
- `changeCount(state)` - each pending entry, deletion, changed frame
  (moved, renamed, a radius, a description, an image), station added that
  no object's placement accounts for, EMPTY station deleted (one holding
  items is counted by their deletes), one for a new order of the
  document's own frames, the setting and each detail field differing from
  the written file. A frame is compared by its data, never by the order
  its keys were built in (`same-json.ts`), so a station moved back is no
  change.
- `effectiveDetails(state)` - the cover only while its image is in the tour.
- `coverImageIds(state)` - the images the tour may show as its cover (its
  photos as they stand, its image assets).
- `detailsChange(state, form)` - a details form checked by the format's
  rules (`checkDetailsForm`), as both pages check it: `changed` with the
  details to dispatch, `unchanged`, or `refused` with the reason in words.
- `pinTextChange(state, id, text)` - a pin's new text by the shared rule
  (`pinTextEdit`: trimmed, never empty), as both pages shape the `edited`
  payload: `edited` with the object to dispatch, `unchanged` (the same
  text, or not a pin), `refused` with the phone's sentence, or `missing`
  for an id the tour does not carry.
- `objectMoveChange(state, id, lat, lon)` - a move on the map
  (`moveObjectTo`, height and facing kept): `moved` with the object
  `before` and `after` (however far: the `moved` action seats it by the
  station rule), or `missing`; throws for a position nobody can draw.
  These two (with `detailsChange`) are why a page imports no rule of
  `object-edits.ts` itself (`config/.dependency-cruiser.cjs`).
- `tourFieldChanges(state)` - `changeCount` less the objects': the moved
  frames, the setting and the detail fields not written yet.
- `viewOf(state)`, `picturesNeeded(state, view)` - for a page's undo: a
  step that brings back a photo the written file has no picture for needs
  the page's picture.
- `framesOf(manifest)`.
- Module-internal (not exported: nothing outside the slice needs them, and
  the root dead-code check holds exports to their importers):
  `contentAt(written, view, keptBare)`, `withFrames(written, frames,
placed, deleted, deletedStations, keptBare)`, `bareEmptyStations`,
  `framesHolding`, `copyTitle`,
  `withNeedsNoGps(manifest, on)`, and the payload and history types
  (`TourHistoryStep`, `TourRestore`, `TourSaved`).
- `nextStep(state, which)` - the step an undo or a redo would go to (the
  desktop session checks its pictures before dispatching); the save status
  types `TourSaveStatus` and `TourSaveHolder` (the desktop page's save slot).
- `isDocumentEdit(action)` - the actions a draft follows (not `saved`, not
  `opened`); `settleApplied` among them, as one edit.
- `isCodeChange(action)` - the code actions that change what a draft's
  codes record holds (the book's texts or the hand; plan M3b). Not
  `codesForgotten`: a tour's close must not empty its draft's codes.
- The rules the reducers keep, exported so a page asks first and says why
  in its own words (`editor-session.ts`'s refusals): `objectFits(state,
object)` (within the format's `TOUR_ITEM_MAX_OFFSET_M` per axis of its
  own station, or of the one its id stands in; FALSE for a station the
  document does not carry, a dangling id; true for an object no station
  holds yet, which the rule seats), `canPlace(state, object)` (an id the
  tour neither carries nor deleted, fitting; `placeRefusal(state, object)`
  names why not - `"deleted"`, `"exists"` or `"too-far"` - so a page
  says the actual reason) and `canStep(state)` (no save
  queued or running). The per-station test under `objectFits` is
  module-private.

## A step across an in-place save (D33)

The desktop's open drops every draft record of an id the file on disk
lacks, so a delete written in place and then undone was lost on a reload
(the tour editor plan's §28/§29 "P2"). The owner's fix (D33, §32): an undo
or a redo that crosses an in-place save writes the file in place again at
once. The slice says when; the page writes (`editor/edit-main.ts`
`resaveIfDue`).

- **The rule** (module-private `stepCrossesInPlaceSave(state, which)`): with
  `w = save.inPlaceAt` and `p = position` before the step,
  - an undo crosses when `w >= p` - it undoes an edit the in-place file
    holds;
  - a redo crosses when `w <= p` - it redoes an edit that file lacks;
  - with `w = "elsewhere"` every step crosses; with `w = null` (no in-place
    save of this open, or the last save a download) none does; a step that
    does not happen (nothing to undo, a save running) crosses nothing.
- **`elsewhere`**: a new edit made below `w` drops the redo that led back to
  the file's view (the file was undone across and its resave had not yet
  landed, or failed). No view on the history is the file's then, so every
  step crosses until a save lands.
- **Positions, not times.** A redo of an edit made after the in-place save
  and undone since crosses it too (the file lacks the edit): it writes at
  once where the autosave would have written a few seconds later.
- **`resave`** is set by the step that crossed and taken on by the next
  `saveClaimed`. A step during the write of an in-place save (after its
  rebuild, which an undo waits for) is measured against the view that write
  holds (`inPlaceWriting`, named by `saved`) as well as against
  `inPlaceAt` - the disk holds one of the two once the write ends - and is
  written once that save ends.
- **A download is no in-place save.** `inPlaceAt` is null after one, so no
  step crosses: a download cannot be rewritten silently. A tour whose saves
  turned into downloads ("Download instead") keeps the earlier in-place file
  on disk as it was; this page no longer writes it.
- **The file's view is named when the write ARRIVES**, not when the save is
  built: `saved` names it `inPlaceWriting`, `saveDelivered` (in place)
  makes it `inPlaceAt`, and a build whose write never arrived keeps its
  view in `inPlaceWriting` (counted only while a save holds the slot) so
  that "tap Save again", which re-delivers the same build, names it when
  it arrives. A refused or failed in-place write therefore leaves
  `inPlaceAt` at the view the disk still holds, and later steps are measured against
  the real file (the disk at view 1, an undo to 0 whose resave fails: a
  redo back to 1 writes nothing, and the undo after it crosses the file
  again; a new edit at 1 drops the disk's view, so its undo crosses too).
  The page also says a failed write: the status line's "Not saved yet -
  tap Save again" (the save built, not delivered), the in-place refusal
  toast, autosave paused, and leaving asks first (`beforeunload`).
- **The walk's move** names its position from its snapshot, taken when the
  move was built; no step can come between that and its commit (the Done
  dialog is modal).

## Invariants & assumptions

- **One copy of the tour.** A page reads the document through selectors and
  changes it only by these actions; it keeps no copy of its own (D29).
- **Undo is over the whole document**, station frames included, and is
  measured against the file as written now: an undo after a save puts back
  what that save wrote as a pending change (property-tested: an undo then a
  redo changes nothing; any sequence followed by undoing everything gives
  the tour back as opened, station order included - which also settles the
  M5a review M2 order deviation for the desktop: the frames in the history
  bring an emptied, pruned station back where it stood).
- **What the state writes is what the rebuild writes**: `manifestToWrite`
  is `finishedManifest`, the function `rebuildFinishedTour` itself calls,
  over the same inputs (property-tested against real zips, for a tour
  opened from a file with debug camera captures and without, and across a
  second save; neither write carries them). It is the
  same rule computed twice, not one call: the save does not read the
  selector, so the property is what holds the two together.
- Reducers are pure: each computes from a plain snapshot (`current`) and
  returns the next state; nothing reads a clock or a random source. A
  station id the rule may need is minted by the caller or the action's
  `prepare`, before the reducer.
- **Every object names one of the document's stations**, and no empty
  automatic station stays (property-tested over placements inside, on the
  edge of and beyond the radius, "New station here", moves, deletes,
  station moves, restored drafts, carried work, saves, undos and redos).
  The rule's values: each station's own found radius (25 m for the ones
  it starts; the radius itself is inside, a tie goes to the earlier
  station); a new station activates at 50 m. A radius that is not a
  positive finite number holds nothing. What would change a verdict: a
  different automatic radius moves the line between joining and starting
  a station by exactly that much, and nothing else.
- **The reducers keep the document's rules** (the r875 milestone review
  #3): a placement of an id the tour carries or deleted, a spot beyond the
  reach of a station it names, a station it names that the document
  lacks, an undo or redo while a save runs - each changes nothing, so a
  second page dispatching the same actions cannot break them. An unknown id
  or station changes nothing either, and NO edit changes anything before a
  tour is open (`written === null`): the setting and the details included
  (PR #644 review), since a history step recorded there is one no undo can
  take back - a step is measured against a written file. The one precondition the page alone
  owns is a photo's picture for an undo (`picturesNeeded`): Blobs are not
  state.
- **The history's cost** (review #9): each step copies the view - every
  station frame and every object in the world - so the history holds up to
  200 times the tour's objects. For the tours made today (tens of objects)
  that is kilobytes; at thousands of objects it reaches tens of megabytes
  and every edit pays an O(objects) copy. The threshold to revisit it
  (steps storing only what changed) is a tour of about a thousand objects.

## Examples

```ts
const store = createTourViewerStore();
store.dispatch(tourDocumentActions.opened({ manifest }));
store.dispatch(
  tourDocumentActions.edited({
    object: { ...pin, label: "New" },
    what: "the text",
  }),
);
changeCount(selectTourDocument(store.getState())); // 1
store.dispatch(tourDocumentActions.undone());
```

## Tests

- `tour-document-codes.test.ts` - the hosted levels in both arrival
  orders with `opened`, an older open's late levels dropped and a newer
  one's replacing them, a failed read counting every saved code as new,
  the same map handed out; the codes taking no history step and surviving
  `opened`, `closed` and an undo; the hand's text winning. A settle as
  one step (plan M3b): its stations, their items and its code taken back
  by one undo and brought back by one redo; a code measured again since
  left as it is by the undo; no step for a settle that changes nothing.
- `tour-document.test.ts` - the step across an in-place save (D33: an undo
  of a written delete, an undo of an edit no save wrote or made after it,
  the second undo below the save, a download, a redo across and not, the
  file off the history, the claim taking it on, the position count), the
  open, pending by content, the same
  content put again as no step, undo and redo,
  the history bound, an undo after a save (the photo needing its picture,
  the emptied station coming back in its place), a station's frame moving
  its items rigidly, the setting and details, a cover following its photo,
  a restore as one step, the save status, an edit made during a save
  staying pending, a late save of another open ignored, the rules the
  reducers keep (each confirmed to fail with its guard turned off), a note
  pending after its station moved and it moved back, and what a pin's text
  and a move on the map would change (`pinTextChange`, `objectMoveChange`).
  "Every object belongs to a station": the found radius itself inside (and
  a micrometre beyond it outside), a station's own radius (5 m and 40 m),
  a tie to the earlier station and two that hold to the nearer, the new
  station's frame, "New station here" within a radius, a taken id and a
  dangling station refused, a move within, out of and back into a radius,
  an object outside its radius nudged (also inside another station's
  overlapping radius, which it then keeps out of),
  the station it left dropped, a delete dropping an emptied automatic
  station and its undo bringing it back exactly, the stations a title, a
  description, a card image asset (not an image of its own deleted photo), a
  step or a route keeps, a placement during a save, a
  restore re-creating its created frames and seating a dangling object,
  carried work re-seated; a card image asset only an earlier view names
  among `historyAssetIds`.
- The save, a thunk against this slice: `tour-document-save.ts.md`.
- `tour-document.property.test.ts` - D33's rule against a model that reads
  the SET of edits each view carries (over random edits, steps, in-place
  saves, failed ones and downloads, and steps while an in-place write is in
  flight holding the slot: a resave is due exactly when a step undoes an
  edit the in-place file - or the write in flight - holds, redoes one it
  lacks, or that view is off the history); over random sequences of edits,
  moves, deletes, placements, station moves, settings, details, undos,
  redos and saves: undo then redo is identity; undoing everything gives the
  opened tour; `manifestToWrite` equals `rebuildFinishedTour`'s written
  manifest on a real zip, opened from a file with debug camera captures
  and without (no write carrying them), and again for a second save after
  the first landed. And the station rule:
  after every step of a random mix of placements (12.5 m steps, so inside,
  on the edge of and beyond the 25 m radius), moves, deletes, station
  moves, restores, carried work, saves, undos and redos, every object
  names one of the document's stations and no empty automatic station
  stays (its two shrunk counterexamples pinned as a named example - an
  undo across a save of a restore, a redo after a station move - each
  seen red with the view's objects left out of `contentAt`'s reading);
  from a tour whose stations carry any mix of descriptions and card
  images, no station a description or an image asset keeps ever leaves the
  frames or the written file; an undo of a placement
  gives the stations back exactly.
- `tour-document-parity.test.ts` - the phone's and the desktop's paths
  write the same tour and draft, the station rule included (a pin
  within a station's radius joins it, one beyond starts one, a move out of
  a radius and into another's, the only pin's delete dropping its
  station); "a pin that starts its own station" is a by-design row (the desktop lacks it until the 3D editor),
  and the harness accepts a by-design row on either page lacking the
  operation. The phone moves a station as its settle does (plan M3b):
  the move and its code's new text as one step, which one undo takes back
  as the desktop's undo of its move does (a row, seen red with the
  phone's undo skipped). Both pages' saves keep a tour's `qr/*.json`
  byte for byte (seen red with either page writing the level again).
- `tour-document-stations.test.ts` - the station edits, each red before
  its reducer existed: a title (trimmed, blank removes it, 80 characters
  taken and 81 refused), the found radius at 2 m and 300 m and just
  outside, a description (over 2000 refused), a card image of that
  station's photo or an asset (any other refused, null removes it), an
  unknown station, the shown photo's delete dropping the card image from
  the write and its undo bringing it back; an add (numbered title, kept
  though empty; a taken id and an undrawable point refused); a delete
  with its items and every route to it pruned as one step, an empty
  station's delete counting as one change (seen red with the
  `deletedStations` exclusion off), the last station refused; a reorder
  (anything but a permutation refused); a copy of a station (new ids,
  items rigidly, a photo under its own file; a story's steps and routes;
  a long title shortened so the copy's fits 80 characters, counted in
  code points, and an image asset's card kept - seen red at 84) and of an
  item (1.5 m east, label marked); a written station no frame names
  edited and copied (seen red: `missing`); a bare empty station of the
  opened file deleted, saved and undone comes back (seen red); items
  grounded as ONE step;
  a model's size at 0.05 m and 500 m and just outside; an item into a
  station of its own; a station the rule started counted once; and as a
  property: any order of station deletes leaves no route to a missing
  station, and a tour the format reads.
- `tour-document-stations-draft.test.ts` - the settings record carries
  the stations edited here and a restore brings each edit back: a rename,
  an add, a delete (its route pruned), a reorder and a copy; only the
  edited frames, and an order only for a reorder or a copy inserted
  mid-tour; a recorded frame restored at the document's pose; a station
  deleted recorded, an automatic one a save dropped once emptied not
  (seen red with the exclusion off); a copied
  station's card image kept through the record (seen red with the
  record's image re-attach off); a frame whose step names an asset parses
  only against the tour; a deleted station an object still names stays
  (seen red with the route pruning off); a created station checked
  against the tour it is restored into (a missing asset leaves it out, a
  missing route target is pruned; each seen red); a record of the earlier
  format restores the poses as before.
- `tour-document.property.test.ts` also mixes the station edits (rename,
  radius, add, delete, reorder, copy of a station and of an item, ground,
  an item into a station of its own) into its sequences, and checks that
  any sequence written to the draft's records and restored over the
  opened tour gives back the same `manifestToWrite`.
- `tour-document.test.ts` also carries a placed 3D model (format minor 1)
  through a pin edit, its station's move and a save: its asset, its size in
  metres and its local pose come back exactly, and the write is at minor 1.
  The slice is kind-agnostic; this pins that it stays so.
