# gizmo-maths.ts

## Purpose

The 3D view's gizmo as pure maths: where its parts lie for a selection,
which part a pointer is on, what a drag of each part sets, and which keys
the scene answers. No drawing, no DOM: `editor3d-gizmo.ts` draws a
layout, `editor3d-input.ts` feeds the pointer and the keys.

## Public API

- `viewHeightAtOneM(fovDeg)` - how tall (m) the view of a vertical lens
  is at 1 m from the camera, 2 tan(fov / 2): the one copy of the 3D
  editor's lens arithmetic (PR bot finding 14, DEC-H3), read by the
  gizmo's sprite scale (`editor3d-editing.ts`), the billboards'
  `resizeBillboard` (`editor3d-marks.ts`) and `focalPxOf`
  (`editor3d-stations.ts`).
- `GIZMO` - the design's sizes: the ring's inner edge (0.88 of its
  radius); an item's ring at least 32 px and 1.25 m (a model's 0.625 m per
  metre of its size); a station's move disc at least 26 px and 2.2 m; the
  knob 30 px beyond the ring, drawn 42 px; a dot drawn 30 px; the stalk
  2 px (at least 0.03 m); a handle under the pointer drawn 1.15 times; a
  group's (a folder's) ring its members' reach (at least 0.6 m) plus 0.2 m,
  and at least 34 px, its move disc 26 px at the pivot.
- `KEY_STEPS` - nudge 0.1 m (Shift 1 m), turn 5 degrees (Shift 15), lift
  0.1 m (Shift 1 m).
- `norm360(deg)`, `angleDiffDeg(a, b)` (signed, in (-180, 180]),
  `compassDeg(from, to)` (a bearing in degrees clockwise from north; world
  x east, z south).
- `gizmoLayout(subject, metresPerPx)` -> `GizmoLayout`. The subject is a
  placeable as the gizmo reads it (`../placement/placeables.ts`): its
  centre, heading, whether it `turns`, its `extent` (a reach, a size or
  a factor, with its value; null: no dots) and whether it is `locked`.
  The layout: the centre, the heading, the ring's radius (null for a
  reach: a station's found-radius circle is the tour's own), the move
  disc (a reach's own disc, else the ring), the four dots (whenever there
  is an extent, at heading + 45 + i x 90 degrees, on the ring), the knob
  along the heading and its stalk (both null for what does not turn: a
  pin's label, a sound). A subject with `spanM` is a GROUP (a plain
  folder): its ring rings its members, its disc is the small one at the
  pivot and the layout says `bodyGrips`. RangeError for a scale that is
  not finite and > 0.
- `groupSpanM(centre, footprints)` - how far a group's members reach from
  its pivot: the farthest corner of their ground footprints (world x/z
  boxes); 0 for none; a box with a bound that is not finite (nothing drawn
  yet) counts nothing.
- `handleAt({ pointer, knob, dots, onDisc, underPointer, posable })` -> `"move"`,
  `"turn"`, `"dot"` or null (the camera's): the knob and the dots first
  (the nearest within half its drawn size), then another object under
  the pointer (no handle, so a click selects it, even over the disc), then
  the move disc. What another item draws without a depth test is therefore
  drawn over the disc (a sound's icon at 21.5 against the disc's 21,
  `editor3d-gizmo.test.ts`), so the creator sees on top what a press
  takes. The disc alone moves: the selected object's body off the disc is no handle
  (a tap selects, a drag turns the camera), and the disc moves even where
  that body covers it.
  With `bodyGrips` (a group's gizmo) the order after the knob and the
  dots is: the small disc (over whatever stands under it, as the chosen
  design draws it over the scene), then a member's body
  (`underPointer: "selected"`: the caller counts the members as the
  selection), and another object takes no handle.
- `turnedHeadingDeg(heading, fromDeg, toDeg, snap)`: whole degrees, 15
  with `snap`; in [0, 360).
- `draggedRadiusM(distanceM, fine, bounds)`: half metres (tenths with
  `fine`), within the row's bounds (a station's 2-300 m).
- `draggedSizeM(sizeM, startM, distanceM, bounds)`: scaled by the ratio,
  three significant digits, within the row's bounds (a model's
  0.05-500 m). The bounds are the placement row's, never this file's:
  `../placement/placement-rows.ts` holds them once.
- `groupScaleBounds(value, format)` - the bounds a folder's scale is
  dragged within: `GIZMO.groupScaleMin` 0.2 to `GIZMO.groupScaleMax` 5
  (the drag the chosen design offers), inside the format's own bounds
  (`format`, 0.1-10, which a file and the typed field still reach), and
  widened to `value` when the scale stands beyond them, so a press never
  jumps a folder typed to 8 back to 5.
- `groupHull(centre, headingDeg, footprints, padM)` -> `GroupHull | null`:
  the dashed outline round a group, a rectangle square to its heading
  that holds every footprint with `padM` to spare on each side; its
  `corners` go round from the front left (front left, front right, back
  right, back left) and `tag` is the front-left corner. Null when no
  footprint is finite.
- `sceneKey(press)` -> `SceneKey | null`: arrows nudge, Alt+Left/Right and
  Q / E turn, PageUp / PageDown lift, Delete / Backspace delete, Ctrl+D
  (Cmd+D) duplicates; null for every key the shell or the page answers (T,
  F, Home, Esc, Ctrl+Z, Ctrl+Y) and any other Ctrl/Cmd chord. Read by
  `code`, so the keyboard layout's letter does not matter.
- Types `WorldPoint`, `GroundSpot`, `ScreenPoint`, `GizmoSubject`,
  `GizmoLayout`, `GizmoHandle`, `Footprint`, `DotBounds`, `GroupHull`, `SceneKey`, `KeyPress`.

## Invariants & assumptions

- Sizes are screen pixels turned into metres by `metresPerPx` at the
  selection, so a handle stays grabbable at any zoom; the minimum metres
  keep a close-up gizmo from shrinking inside the object.
- The knob lies the ring's radius plus 30 px along the heading, the dots
  on the ring (the property test sweeps scales over 1e-4..10 m a pixel).
- A grip is half the drawn size: the pictures carry a transparent margin.
- A locked placeable (`GizmoSubject.locked`; today only a station can be locked): `gizmoLayout` reports `posable: false` and `handleAt({ posable: false })` answers only a dot - the knob, the selection and the disc take no handle.
- No knob without `turns`: what always faces the camera or the viewer shows no knob and no stalk, so the gizmo never offers a turn that would not show.

## Examples

```ts
const layout = gizmoLayout(
  { centre, headingDeg: 90, turns: true, extent: null, locked: false },
  0.05,
);
sceneKey({
  code: "KeyE",
  key: "e",
  shiftKey: true,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
});
// { kind: "turn", deg: 15 }
```

## Tests

`gizmo-maths.test.ts`: `viewHeightAtOneM` at 50, 60 and 90 degrees; the layout for a station, a turning item, a model and a facing pin (no knob, no stalk); the
minimum sizes, and the move disc's touch size swept over camera
distances of 5-300 m; the hit order, one case per thing under a press
(the body, the disc, the disc under the body, the knob, a dot, another
item, empty ground); the turn, radius and size rules with
their bounds; every key of the design and the keys left to others; and a
property: the knob's distance and bearing from the centre and the parts'
bounds over random subjects and scales.

`gizmo-maths.test.ts` also pins the dashed outline round a group (an exact
case; a property that every footprint keeps exactly the pad to the nearest
edge it touches; null for no finite footprint), and a locked station's layout (dots kept, not posable) and its handles (a dot only).
