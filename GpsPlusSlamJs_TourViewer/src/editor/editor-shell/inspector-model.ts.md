# inspector-model.ts

## Purpose

The 3D view's inspector as data, pure: the selected station's, item's or
code's fields, read-only, as the file holds them. The DOM is
`shell-inspector.ts`'s.

## Public API

- `buildInspector({ selected, stations, assets, codes })` ->
  `InspectorModel | null`:
  - `StationInspector` - `kind: "station"`, title, `sub` "Station n of
    N", `place` (`{ number, count }`, for Earlier and Later), description, `imagePath`, `foundRadiusM`, `activateRadiusM`,
    `position` (`InspectorPosition`), or null when the station's point
    or the tour's centre cannot be read;
  - `ItemInspector` - `kind: "item"`, `itemKind`, title, `sub` naming
    its station, `sizeM` (a model's, else null), `offset` (`northM`,
    `upM`, `eastM` in the station's frame), `headingDeg`;
  - `CodeInspector` - `kind: "code"`, title, `sub` (its line),
    `printSizeM`, `position` or null when it has none;
  - `InspectorPosition` - `eastM` and `northM` from the tour's centre
    (the 3D view's origin: `tourCentre` of the stations, else of the
    codes, `../tour-origin.ts`), `altM` over the ellipsoid as the file
    holds it, and `headingDeg` (the file's, else read from its rotation,
    else null);
  - null without a selection or for one the tour does not have.
- `InspectorCode` - `{ id, title, meta, geo | null, printSizeM | null }`,
  the page's view of a code.
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

- Read-only: nothing here edits. A position is shown as the 3D view
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

`inspector-model.test.ts` also covers `locked` and the locked hint.
