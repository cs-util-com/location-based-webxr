# station-geometry.ts

## Purpose

The geometry of a station and its items as the editor changes them: the
bounds of a found radius and the preload radius it implies, where a copy of
a station or of an item stands, the height rule, and a station's rigid
move. Pure, and at the top level of `src/` so the tour document's reducers
may use it (top-level modules never import `src/editor/`).

## Public API

- `STATION_RADIUS_MIN_M` (2) and `STATION_RADIUS_MAX_M` (300): the found
  radius a creator may set, both inclusive.
- `isStationRadius(m)`: a finite number within those bounds.
- `preloadRadiusM(found)`: twice the found radius - the radius from which
  a station is preloaded and guided to (`activateRadiusM`).
- `ITEM_DUPLICATE_OFFSET_M` (1.5): how far east of its original an item's
  copy stands.
- `duplicateStationGeo(frame)`: where a station's copy stands - twice its
  found radius plus 5 m east, at its height, turned like it, so the copy's
  circle never overlaps the original's preload ring.
- `duplicateItemGeo(geo)`: 1.5 m east, at the same height and facing.
- `altKeepingHeight({ alt, groundBefore, groundAfter })`: the altitude
  that keeps an item's height above the ground when the ground under it
  changes (all ellipsoidal metres). No caller yet: the 3D editor's drag
  over the terrain is its first; it lives here with the other rules the
  editor's gestures reduce to.
- `rigidlyMoved(geo, from, to)`: where an item of the station at `from`
  stands once the station moved to `to` - its local pose kept
  (`localPoseOf`, then `itemGeoPose`).

## Invariants and assumptions

- The tour file holds ellipsoidal altitudes (the creator's GPS-world Up).
  An item moved over other ground keeps its height ABOVE the ground unless
  the creator lifts it; "put on the ground" sets the altitude to the
  ground's (the caller measures the ground).
- A station moves rigidly: its items keep their local poses within 1 mm,
  and moving back returns them within 1 mm.
- No input is clamped: a radius outside the bounds is refused by
  `isStationRadius`, never silently corrected. The geo functions expect
  finite coordinates (the callers validate points at their boundary).
- A yaw from a drag is not here yet: no caller needs it before the 3D
  editor's gizmo.

## Examples

```ts
isStationRadius(2); // true
isStationRadius(300.001); // false
preloadRadiusM(25); // 50
duplicateStationGeo({ geo, foundRadiusM: 25 }); // 55 m east of geo
altKeepingHeight({ alt: 571.5, groundBefore: 566.5, groundAfter: 570 }); // 575
```

## Tests

`station-geometry.test.ts`: the radius bounds at both edges and just
outside them (and NaN, infinity), the preload radius at both edges, the
copy distances for found radii 2, 25 and 300 m, the height rule as a unit
case and as a property against a terrain model of its own (a drag of up
to 30 moves over ground from -50 m to about 2800 m, items from 5 m below
to 50 m above it: the height held at every step, the start's altitude
back after dragging back - not the formula restated), and the rigid move as properties (stations up to 1 km
apart and turned any way, items up to 300 m away: local pose kept within
1 mm, the move back within 1 mm; local to geo to local within 1 mm).
