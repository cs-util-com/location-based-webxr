# inspector-model.ts

## Purpose

The 3D view's inspector as data, pure: the selected station's, item's or
code's fields, read-only, as the file holds them. The DOM is
`shell-inspector.ts`'s.

## Public API

- `buildInspector({ selected, stations, assets, codes })` ->
  `InspectorModel | null`:
  - `StationInspector` - `kind: "station"`, title, `sub` "Station n of
    N", description, `imagePath`, `foundRadiusM`, `activateRadiusM`,
    `position` (`lat`, `lon`, `altM` over the ellipsoid, `headingDeg`);
  - `ItemInspector` - `kind: "item"`, `itemKind`, title, `sub` naming
    its station, `sizeM` (a model's, else null), `offset` (`northM`,
    `upM`, `eastM` in the station's frame), `headingDeg`;
  - `CodeInspector` - `kind: "code"`, title, `sub` (its line),
    `printSizeM`, `position` or null when it has none;
  - null without a selection or for one the tour does not have.
- `InspectorCode` - `{ id, title, meta, geo | null, printSizeM | null }`,
  the page's view of a code.
- `headingOfRotation(q)` - the bearing (0-360, clockwise from north) a
  rotation in a north-up-east frame turns the item's forward to; null for
  a rotation that is not finite.

## Invariants & assumptions

- Read-only: nothing here edits; the fields are shown as the file holds
  them (latitude, longitude, height), not as distances from the tour's
  origin.
- A station's position is its own point; an item's is its offset in its
  station's frame (north, up, east).

## Examples

```ts
const model = buildInspector({ selected, stations, assets, codes });
if (model?.kind === "station") console.log(model.position.lat);
```

## Tests

`inspector-model.test.ts`: nothing without a selection or for an unknown
one; a station's, an item's and a code's fields (and a code without a
position); `headingOfRotation` for turns about up.
