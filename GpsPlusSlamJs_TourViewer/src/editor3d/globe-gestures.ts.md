# globe-gestures.ts

## Purpose

The gesture table of the editor on the globe: for each input, whether the
globe's camera controls or the editor owns it. The owner decided it on
2026-10-27 (the camera as in the globe lab, the rest adapted, the right
click kept), with the lab's measurements of 2026-10-27 night (a 5 px
threshold; `contextmenu` and `click` fire after a drag too, so the page
counts movement itself). Pure: the page wires each route.

## Public API

- `GLOBE_GESTURES` - `dragPx` 5: a press moved this far or more is a drag.
- `routeGlobeInput(input, dragPx?)` -> `GlobeRoute`. RangeError for a
  release's `movedPx` that is NaN or negative, or a `dragPx` that is not
  finite and positive.
- Types `GlobeInput` (`press`, `release` with `movedPx`, `double`,
  `arrow` with `selected`, `fingers` with where the first finger started), `GlobeHit` (`object`, `handle`, `ground`,
  `sky`), `GlobeRoute`.

## The table

- **Right button:** the press goes to the camera (a drag rotates); its
  release moved `dragPx` or more is `none` (it was a turn), less is `menu`
  (the editor's menu at the pointer), whatever is under it.
- **Left button:** a press on a gizmo handle is `edit` (the page leases the
  controls off) and its release is `edit` (the edit ends) however far it
  moved; any other press is `camera` (a drag pans). A release under
  `dragPx` on an object is `select`, on the ground or the sky `deselect`;
  at or over it `none` (a pan selects nothing).
- **Double click:** on an object `select-and-fly`; on the ground or the
  sky `camera-zoom` (the controls' own zoom); on a handle `none`.
- **Arrow keys:** with a selection `nudge`, without one `camera-step`. The
  lab's controls take no keys (their flight mode is off), so the page
  steps the camera itself. This follows the owner's decision of
  2026-10-27 ("move the camera otherwise") over the GV0 results' later
  recommendation of nothing (Q-G3, moved to this milestone).

- **Two fingers:** `camera`, wherever the first finger started: the
  globe's controls pinch, twist and tilt as in the lab. A handle drag the
  first finger started is cancelled (the input's rule for a second
  finger, the edit undone). The page wires this through the editing
  camera's `takesTwoFingers`: the input then neither locks the camera for
  two fingers nor reads them itself. Before this row the input locked
  the camera and read the fingers for the OrbitControls view's own
  gestures, which the globe has none of, so two fingers held the camera
  still.

## Invariants & assumptions

- Every input has exactly one route; only a left button on a handle ever
  reaches the gizmo.
- `dragPx` was measured in the lab at 3-8 px (3 px allows about 1.2
  degrees of accidental turn, 8 px about 3.3; a quick flick turns about 5
  degrees at any threshold); the tests sweep 3, 5 and 8.
- Movement is the page's to measure (from the press to the release, in
  CSS px), because the browser's `contextmenu` and `click` arrive after a
  drag too.

## Examples

```ts
const route = routeGlobeInput({
  kind: "release",
  button: "right",
  on: "ground",
  movedPx,
});
if (route === "menu") shell.groundMenu(point, place);
```

## Tests

`globe-gestures.test.ts`: every row (right drag and click, left click on
an object, the ground and the sky, a left drag selecting nothing, the
handle's press and release, the double click on each hit, the arrows with
and without a selection), the threshold at 5 px and swept over 3, 5, 8,
refusals. `globe-gestures.property.test.ts`: one known route for any input
and threshold in 3-8 px, a right click and a right drag routed apart, the
gizmo reached only by a left button on a handle.
