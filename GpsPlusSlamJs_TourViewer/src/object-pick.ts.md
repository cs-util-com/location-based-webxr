# object-pick.ts

## Purpose

Selecting a placed object in AR (authoring plan 2026-09-28-0953 §3.4,
owner decision D7; M4 review #4): a ray from the camera through the point
the creator TAPPED - the screen centre, where the reticle ring sits, when
the tap's own ray is not known - cast against the objects' own geometry,
with an angular tolerance around it.

## Public API

- `pickObject(camera, targets, { ndc?, toleranceDeg? }): string | null` -
  `targets` maps each object id to its rendered root
  (`RenderedTourObjects.root`). An exact hit wins: the id whose root is an
  ancestor of the NEAREST hit. Without one, the object whose CENTRE (its
  bounding box's) is nearest the ray in angle, if within the tolerance; a
  tie goes to the nearer object. Null on a miss or with no targets.
  - `ndc` - where the tap was, in normalized device coordinates; the
    screen centre by default.
  - `toleranceDeg` - `PICK_TOLERANCE_DEG` by default; 0 (or less) is the
    exact raycast alone.
- `ndcOfTargetRay(camera, targetRayInCamera): Ndc | null` - the screen
  point a tap's target ray passes through. `targetRayInCamera` is a
  column-major 4x4 pose in the camera's own frame with the ray along -Z:
  the framework reticle driver's `targetRayInViewer` (the viewer is the
  camera on a handheld device). A screen tap's ray starts at the eye, so
  its direction alone names the point, projected through
  `camera.projectionMatrix` (the XR projection in a session). Null for a
  malformed matrix or a ray not pointing into the view.
- `PICK_TOLERANCE_DEG` - 3 (see below).

## Invariants & assumptions

- **Not the reticle's hit point**: that lies on a surface, while a pin's
  label floats above its surface, so "the object nearest the hit point"
  picks wrongly whenever two objects stand close (cold review #11). The
  ray hits the label sprite or the photo plane itself.
- **The tap point, not only the screen centre** (M4 review #4): the
  framework driver reads the tap's target ray inside the XR `select` event
  and the `pickObjectInView` seam turns it into NDC here; a tap whose event
  carried no pose falls back to the centre.
- **The tolerance is measured to the CENTRE, so it acts as a MINIMUM
  target size.** A far label is pickable within the tolerance of its
  middle; a near one, already larger than that on screen, gains nothing,
  so a tap on empty scene beside it stays empty. The first version
  measured to the bounding sphere's EDGE: at 2-5 m it selected a
  neighbour on 26-57 % of taps the exact ray found empty, even at 1°.
- The raycast is the framework's `raycastPointer`
  (`visualization/pointer-picking`, DEC-H3), which sets the raycaster's
  camera - three's `Sprite.raycast` requires it.
- The camera's and the objects' world matrices must be current; in an
  immersive session the render loop keeps them so.
- **The selection's fallback is the AR chooser** (`object-list.ts`,
  Previous / Next): whatever the tolerance, a far, occluded or crowded
  object can always be reached without aiming.

## Why 3 degrees - the sweep

`object-pick-tolerance.test.ts` simulates taps on synthetic scenes through
the real `pickObject`: 3 or 8 real label sprites (0.6 x 0.3 m) at 2-5 m or
10-20 m, spread over ±20° of yaw and ±8° of pitch, a portrait camera
(60° vertical field of view); 150 scenes per cell, a tap aimed at one label
with Gaussian angular error σ per axis, and a tap at a direction the exact
ray finds empty. Each cell: aimed-at label picked / another picked / empty
tap picked something, in %, at tolerances 0-6°.

- σ 1°, 10-20 m, 3 objects: 0° 37/1/0 · 1° 46/1/0 · 2° 86/1/3 ·
  **3° 98/1/10** · 4° 99/1/19 · 6° 99/1/35
- σ 1°, 10-20 m, 8 objects: 0° 24/1/0 · 2° 81/5/8 · **3° 93/6/23** ·
  4° 94/6/37 · 6° 94/6/65
- σ 2°, 10-20 m, 3 objects: 0° 12/1/0 · 2° 34/5/9 · **3° 60/7/15** ·
  4° 80/7/23 · 5° 88/7/29 · 6° 92/7/34
- σ 2°, 10-20 m, 8 objects: 0° 8/2/0 · 2° 40/6/7 · **3° 55/12/19** ·
  4° 73/14/35 · 6° 82/17/66
- σ 3°, 10-20 m, 3 objects: 0° 5/1/0 · **3° 37/5/11** · 4° 58/5/17 ·
  6° 83/6/31
- 2-5 m, any σ: the hit rate barely moves with the tolerance (the labels
  are larger than it on screen), and empty taps stay empty: at 3° they
  pick something on 1-5 %, at 4° on 3-13 %, at 6° on 15-45 %. The 29-31 %
  "wrong" with 8 objects at 2-5 m is there at 0° too - labels overlapping
  on screen, which no tolerance changes (the chooser does).

The finger's error in degrees: a portrait phone shows about 0.4-0.55° per
millimetre, and a fingertip lands with roughly 1.5-2.5 mm of spread, so
σ ≈ 1° is the realistic case and 2° a shaky hand in AR. **3°** recovers far
labels almost completely at σ 1° (37 → 98 %) and five- to sevenfold at
σ 2-3°, while near scenes keep empty taps empty (≤ 5 %) and far crowded
scenes keep wrong picks at 6-12 %. A 3° radius is a 6° target, 11-15 mm on
screen - a little over the 7-10 mm minimum touch target the platform
guidelines ask for.

**What would reverse it**: a field finger error of 2° or more (AR hand
shake) argues for **4°** (far hits at σ 2°: 60 → 80 %) at the price of
empty taps in far crowded scenes selecting something (19 → 35 %);
creators complaining that a tap meant to clear the selection picks a
neighbour argues for **2°**. Each costs one constant.

## Examples

```ts
const ndc = ndcOfTargetRay(getCamera(), tap.targetRayInViewer);
const id = pickObject(getCamera(), new Map([["pin-1", preview.root]]), {
  ...(ndc === null ? {} : { ndc }),
});
```

## Tests

- `object-pick.test.ts` - with real three.js objects: a label's sprite, a
  photo's plane, the nearest of two on the ray, a miss, a hit nested under
  its root; a far label beside the ray picked within the tolerance only,
  an exact hit preferred over an object near in angle and otherwise the
  nearest in angle, the tapped point instead of the centre, and
  `ndcOfTargetRay` (a turned ray, the view axis, a backward ray, a
  malformed matrix).
- `object-pick-tolerance.test.ts` - the sweep above, pinned at the chosen
  value (deterministic, seeded; `PICK_SWEEP_PRINT=1` prints the table).
- The e2e scene is a stub with no geometry, so these are the only places
  the ray meets real objects; the e2e covers the wiring through the
  `pickObjectInView` seam, and `authoring-settle.test.ts` that the tap's
  ray reaches it.
