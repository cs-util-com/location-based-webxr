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
  2 px (at least 0.03 m); a handle under the pointer drawn 1.15 times.
- `KEY_STEPS` - nudge 0.1 m (Shift 1 m), turn 5 degrees (Shift 15), lift
  0.1 m (Shift 1 m).
- `norm360(deg)`, `angleDiffDeg(a, b)` (signed, in (-180, 180]),
  `compassDeg(from, to)` (a bearing in degrees clockwise from north; world
  x east, z south).
- `gizmoLayout(subject, metresPerPx)` -> `GizmoLayout`: the centre, the
  heading, the ring's radius (null for a station: its found-radius circle
  is the tour's own), the move disc, the four dots (a station or a model,
  at heading + 45 + i x 90 degrees), the knob along the heading, the
  stalk. RangeError for a scale that is not finite and > 0.
- `handleAt({ pointer, knob, dots, onDisc, underPointer })` -> `"move"`,
  `"turn"`, `"dot"` or null (the camera's): the knob and the dots first
  (the nearest within half its drawn size), then an object under the
  pointer (the selected one moves; another takes no handle, so a click
  selects it), then the move disc.
- `turnedHeadingDeg(heading, fromDeg, toDeg, snap)`: whole degrees, 15
  with `snap`; in [0, 360).
- `draggedRadiusM(distanceM, fine)`: half metres (tenths with `fine`),
  2-300 m.
- `draggedSizeM(sizeM, startM, distanceM)`: scaled by the ratio, three
  significant digits, 0.05-500 m.
- `sceneKey(press)` -> `SceneKey | null`: arrows nudge, Alt+Left/Right and
  Q / E turn, PageUp / PageDown lift, Delete / Backspace delete, Ctrl+D
  (Cmd+D) duplicates; null for every key the shell or the page answers (T,
  F, Home, Esc, Ctrl+Z, Ctrl+Y) and any other Ctrl/Cmd chord. Read by
  `code`, so the keyboard layout's letter does not matter.
- Types `WorldPoint`, `GroundSpot`, `ScreenPoint`, `GizmoSubject`,
  `GizmoLayout`, `GizmoHandle`, `SceneKey`, `KeyPress`.

## Invariants & assumptions

- Sizes are screen pixels turned into metres by `metresPerPx` at the
  selection, so a handle stays grabbable at any zoom; the minimum metres
  keep a close-up gizmo from shrinking inside the object.
- The knob lies the ring's radius plus 30 px along the heading, the dots
  on the ring (the property test sweeps scales over 1e-4..10 m a pixel).
- A grip is half the drawn size: the pictures carry a transparent margin.
- A locked station (`GizmoSubject.locked`): `gizmoLayout` reports `posable: false` and `handleAt({ posable: false })` answers only a dot - the knob, the selection and the disc take no handle. `locked` means nothing on an item.

## Examples

```ts
const layout = gizmoLayout(
  { kind: "item", centre, headingDeg: 90, radiusM: null, sizeM: null },
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

`gizmo-maths.test.ts`: `viewHeightAtOneM` at 50, 60 and 90 degrees; the layout for a station, a pin and a model; the
minimum sizes; the hit order (the sprites first, the nearest wins; an
object under the pointer; the disc); the turn, radius and size rules with
their bounds; every key of the design and the keys left to others; and a
property: the knob's distance and bearing from the centre and the parts'
bounds over random subjects and scales.

`gizmo-maths.test.ts` also pins a locked station's layout (dots kept, not posable) and its handles (a dot only).
