# inspector-model.ts

## Purpose

The 3D view's inspector as data, pure: the selected station's, item's or
code's fields as the file holds them, and what the inspector offers to
edit. The DOM is `shell-inspector.ts`'s; what a typed value writes is
`inspector-edits.ts`'s.

## Public API

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
    the found circle), `offGround` (how many items stand more than
    `ON_GROUND_M` off the ground; null while the ground under any has not
    loaded), `groundOffM` (the anchor's height over the ground as shown:
    in tenths of a metre, 0 within `ON_GROUND_M`; null while unknown),
    `position` (`InspectorPosition`), or null when the
    station's point or the origin cannot be read, and `story`
    (`InspectorStoryBlock[]`: the blocks its story shows,
    `storyBlocksOf`, in the station's order, each `{ id, kind, title }`
    with the kind in the block model's words and the name by
    `objectTitle` (`../../object-describe.ts`, the one naming rule); listed, not edited, here);
  - `ItemInspector` - `kind: "item"`, `itemKind`, title, `sub` naming
    its kind in the one word every creator page uses and its station ("Pin in
    Market Square", "Photo in ...", "3D model in ...", `BLOCK_KIND_LABEL`; the
    title by `objectTitle`), `stationId`, `text` (a pin's caption to edit; null for a
    photo or a model), `sizeM` (a model's, else null), `fields` (its
    other text fields to type, `blockFields` of `../block-fields.ts`:
    a short text's description, a picture's title, caption and alt text,
    a model's title), `offset`
    (`northM`, `upM`, `eastM` in the station's frame), `headingDeg`,
    `groundOffM` (its height over the ground, rounded as the station's;
    null while unknown);
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
- `inspectorHint(model | null)` - the bottom bar's hint: the handles the
  selection's gizmo has in the 3D view (a station: move, radius dot,
  turn; an item: move and turn, a model also a size dot; a code: none,
  read-only), or how to select when nothing is (and that a right click
  on the ground starts a station).

## Invariants & assumptions

- Pure: nothing here edits. A position is shown as the 3D view
  places it: metres east and north of the tour's centre (`eastNorthOf`,
  exact on the WGS84 ellipsoid at height 0, so the numbers match the
  scene's x and -z), with the height as the file holds it. A creator
  compares stations by those metres; latitude and longitude are what the
  map shows.
- A station's position is its own point; an item's is its offset in its
  station's frame (north, up, east).
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
straight up or down; `inspectorHint` for each kind and for none.

`inspector-model.test.ts` also covers `locked` and the locked hint, and
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
