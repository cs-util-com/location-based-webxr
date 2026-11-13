# inspector-model.ts

## Purpose

The 3D view's inspector as data, pure: the selected station's, item's or
code's fields as the file holds them, and what the inspector offers to
edit. The DOM is `shell-inspector.ts`'s; what a typed value writes is
`inspector-edits.ts`'s.

## Public API

- `InspectorMoves` (`moves` of a story's, an entry's and an item's
  inspector): `step` (`{ earlier, later }`, whether each is possible; null
  for a free item, as the free items have no order) and `targets` (each
  list the move rule takes it into, with its button's words: "Move out of
  the story", 'Move into "<title>"'), and `stations` (each other station
  `movedToStation` lets it go to, `{ id, label }` labelled by its title).
  No
  story for a free item whose file the tour on disk lacks
  (`selectedFileUnsaved`, from `freeItemUnsaved`: the move would be
  refused).
- `buildInspector({ selected, stations, assets, codes, unlockedStations?,
origin?, groundAt? })` ->
  `InspectorModel | null`:
  - `StationInspector` - `kind: "station"`, title, `sub` "Station n of
    N", `place` (`{ number, count }`, for Earlier and Later), `name`
    (its own title to edit, empty for an untitled one), description,
    `imagePath`, `images` (the station's photos, each its image asset's
    path, then the tour's other image assets - a captured photo's own
    asset is its photo's, never listed twice - each `{ id, path, label }`,
    `id` the ASSET id a station's `image` names: a picture is offered by
    the image it shows, and each asset once, B2a review 3) and
    `imageId` (the one its card shows, or null), `foundRadiusM`,
    `activateRadiusM`, `outside` (how many of its items stand outside
    the found circle: `tour-problems.ts`'s `outsideItems`, the rule the
    bottom panel's Problems tab lists by), `offGround` (how many items stand more than
    `ON_GROUND_M` off the ground; null while the ground under any has not
    loaded), `groundOffM` (the anchor's height over the ground as shown:
    in tenths of a metre, 0 within `ON_GROUND_M`; null while unknown),
    `position` (`InspectorPosition`), or null when the
    station's point or the origin cannot be read;
  - `FolderInspector` - `kind: "folder"` (selection `folder:<id>`),
    `folderId`, `stationId`, `title` (`folderName`), `sub` ("Folder in
    <station>, 2 items", its items at any depth), `scale`
    (`InspectorScale`: its placement row's label, meaning and bounds and
    the tour's value, 1 for none), `offset` and `headingDeg` (its origin
    in its station's frame, its holders composed in), `groundOffM`,
    `phoneDetails: false` (a phone shows no details sheet for it: a tap
    keeps the list and the folder's band, and the 3D handles move, turn
    and scale it; its typed fields are for a wider window); read
    through `placeableOf`, so it shows what the gizmo moves;
  - `StoryInspector` - `kind: "story"` (selection `story:<id>`), `storyId`,
    `stationId`, `title`, `sub` ("2 The gate / Story") and `entries`
    (`storyRows` of `tree-model.ts`: `{ id, kind, title, place }`);
  - `StoryEntryInspector` - `kind: "storyEntry"`, a block of a story: `id`,
    `stationId`, `rowKind`, `title`, `sub` ("2 The gate / The legend / Long
    text, entry 1"), `block` (`InspectorStoryBlock { id, kind, title, fields,
character? }`, `kind` in the block model's words, `title` by `objectTitle`,
    `fields` by `storyBlockFields`; a character carries `InspectorCharacter {
view, advance, facingDeg }`) and `advance { mode, afterS }`;
  - `StoryStepInspector` - `kind: "storyStep"`, `stepKind` "choice" or "quiz",
    `id`, `stationId`, `title`, `sub`, `heading` and `lines`: where each answer
    leads, or a quiz's points and its answers with the right one said (a typed
    answer's check is not said);
  - `ItemInspector` - `kind: "item"`, every free block (a video and a
    free character too), `itemKind`, title, `sub` naming
    its kind in the one word every creator page uses and its station ("Pin in
    Market Square", "Photo in ...", "3D model in ...", `KIND_EDIT` label; the
    title by `objectTitle`), `stationId`, `text` (a pin's caption to edit; null for a
    photo or a model), `extent` (`InspectorExtent`: the size its white
    dots change, as its placement row gives it - `field`, `label`,
    `meaning`, the tour's `value`, `min`, `max`; a model's Size, a
    picture's Width; null for an item with none), `fields` (its
    other text fields to type, `blockFields` of `../block-fields.ts`:
    a short text's description, a picture's title, caption and alt text,
    a model's title), `offset`
    (`northM`, `upM`, `eastM` in the station's frame, its folders composed
    in; null for a block with no place in the world, a video),
    `headingDeg` (in the same frame; null with no place), `turns` (its
    placement row's: its gizmo has the round arrow), and `groundOffM` (the height
    over the ground of where it stands in the world, through its
    folders, `posedEntryOf` of `../../placement/placeables.ts`; rounded as
    the station's; null while unknown or with no place);
  - `CodeInspector` - `kind: "code"`, title, `sub` (its line),
    `printSizeM`, `position` or null when it has none;
  - `InspectorPosition` - `eastM` and `northM` from `origin` when it
    is given (the 3D view's, fixed when it opened), else from the tour's
    centre (`tourCentre` of the stations, else of the codes,
    `../tour-origin.ts`), `altM` over the ellipsoid as the file
    holds it, and `headingDeg` (the file's, else read from its rotation,
    else null);
  - null without a selection or for one the tour does not have.
- `InspectorCode` - `{ id, title, meta, geo | null, printSizeM | null }`,
  the page's view of a code.
- `InspectorGround` - the ground's ellipsoidal height at a place (null
  where none has loaded), the 3D view's `groundAt`.
- `ON_GROUND_M` (0.05) - what stands this near the ground is on it.
- `headingOfRotation(q)` - the bearing (0-360, clockwise from north) a
  rotation in a north-up-east frame turns the item's forward to; null for
  a rotation that is not finite, and null for one that turns the forward
  straight up or down (no bearing then: its north and east parts are
  both under 1e-9).
- `detailsOnPhone(model)` - whether a phone shows `model` as its details
  sheet: true unless the model says `phoneDetails: false` (a folder). The
  shell asks this, never the selection's kind.
- `inspectorHint(model | null)` - the bottom bar's hint: the handles the
  selection's gizmo has in the 3D view (a station: move, radius dot,
  turn; an item: move and turn, a size dot where it has an `extent` (a
  model, a picture); a code: none,
  read-only), or how to select when nothing is (and that a right click
  on the ground starts a station).
- `MODEL_VIEW_CHOICES` - the format's world views with their labels, in
  the inspector's order.
- `CHARACTER_VIEW_CHOICES` - a character's story views
  (`TOUR_CHARACTER_VIEWS`, in the format's order) with the station-blocks-7
  prototype's labels: Bubble, Tap to speak, Two stations, Portrait, Pop-up.
- `ItemInspector.model` - for a model, its parts
  (`InspectorModelParts`: the view, the notes with title, text and place,
  whether the notes are full, the sections with name, place and normal,
  whether the sections are full, the clip or null, and the store's
  `modelFocus` and `modelPick`); null for every other item.
- `buildInspector` takes the store's `modelFocus` and `modelPick`.
- `ItemInspector.longText` - for a free long text, what its writer shows
  (`InspectorLongText`: the block id, its stored view, title and body,
  whether it has a narration, the visitor's line above the title - the
  station's name and number - and the tour's pictures `{ id, path, label }`
  for the picture button); null for every other item, and for a long text a
  station's story shows (its prose stays a field there). Its body and title
  are not repeated in `fields`.
- A station's model carries `contents`: its stories and its free items from
  `stationContents` (`tree-model.ts`); a story's parts are the story's.

## Invariants & assumptions

- Pure: nothing here edits. A position is shown as the 3D view
  places it: metres east and north of the tour's centre (`eastNorthOf`,
  exact on the WGS84 ellipsoid at height 0, so the numbers match the
  scene's x and -z), with the height as the file holds it. A creator
  compares stations by those metres; latitude and longitude are what the
  map shows.
- A station's position is its own point; an item's is its offset in its
  station's frame (north, up, east), its folders composed in, which is
  also the frame its typed fields write back (`inspector-edits.ts`). Its
  height off the ground and the station's count of items off the ground
  are judged where it stands in the world.
- The hint names the round arrow only for an item whose gizmo turns it
  (`turns`), the white dot only for a model, and says an item with no
  place in the world has none in the 3D view.
- A station's model carries `locked` (from `unlockedStations`, locked by default). A locked station's hint names its radius dot and says how to unlock it, never a drag the lock refuses.

## Examples

```ts
const model = buildInspector({ selected, stations, assets, codes });
if (model?.kind === "station") console.log(model.position?.eastM);
```

## Tests

`inspector-model.test.ts`: nothing without a selection or for an unknown
one; a station's, an item's and a code's fields (and a code without a
position); a station east and north of the tour's centre in metres;
`headingOfRotation` for turns about up, and none for a forward turned
straight up or down; `inspectorHint` for each kind and for none (a pin
with no round arrow, a video with no place); a video as an item with no
place; a free character as an item with its place and turn; an item in
a turned folder with its offset in the station's frame and its height
off the ground where it stands.

`inspector-model.test.ts` also covers a plain folder (its name, station
and item count, its scale and bounds, its origin and heading in its
station's frame, its ground, its hint; none for one the tour lacks),
`locked` and the locked hint, and
the values the inspector edits: a station's own name, the card's
choices with the one shown marked, the items outside the circle, a
position from a given origin, how far a station and its items stand off
the ground (null before it has loaded), and a pin's text (none for a
photo or a model). A property pins the heights off the ground as shown
(tenths, 0 within `ON_GROUND_M`, within 5 cm of the true value) and that
ground changing by a few millimetres without crossing a shown tenth
leaves the model unchanged: the shell's readout draws the inspector again
whenever its model changes, so a model carrying raw heights was drawn
again under the creator's typing on every tile of finer ground.

## Narration key

`InspectorLongText.narrationKey` is the narration record (JSON) plus the input's `timingsStamp`: the Narration section re-reads when it changes.

## `file`

`InspectorModel` carries an optional `file` (`inspector-file.ts`), added
by the shell after `buildInspector`; `buildInspector` itself never sets
it.

## Short text parts

A short text's item carries `shortText: { view, role, orientation }` (role and orientation null when not written) for its kind panel; a ground arrow adds `ground: { id, style, floorPlacement, captionOnArrow, color, darkColor }` (null when not written, the switch false).

An item's `sub` names it by `blockLabel` (`kinds/edit-kinds.ts`): a short text by its view.
