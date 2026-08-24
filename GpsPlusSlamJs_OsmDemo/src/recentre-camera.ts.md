# `recentre-camera.ts` — moving the orbit pivot without rotating the camera

## Purpose

Translate the camera and its orbit target so the target sits at a given scene
point — **without rotating the camera**.

## Public API

- `OrbitTarget` — `{ target: THREE.Vector3, update() }`. A structural type
  rather than an import of `MapControls`, so the contract is "anything with an
  orbit target".
- `recentreOn(camera: THREE.Object3D, controls: OrbitTarget, at: {x, y, z}): void`
  — a no-op when the target is already at `at`. Never throws.

## Invariants & assumptions

- **`at` is the USER, not the scene origin.** Those were the same point while
  the ENU frame was rebuilt at the user's position on every publish. Since
  `scene-anchor.ts` fixed the frame they are not: the origin is where the scene
  was anchored, and recentring on it would drag the camera back to the session
  start on every step. The pivot is computed page-side —
  `enuFrameAt(sceneAnchor).toEnu(position)` in `main.ts` — because both inputs
  are already there and no worker round trip is needed.
- **The camera's orientation is unchanged, by construction.** Camera and target
  move by the same vector, so the camera→target offset is bit-identical and the
  quaternion cannot move. This is the requirement the round-4 notes state
  outright ("nur ihre Translation ändern"), and it is why the implementation is
  a subtraction rather than a recomputation from distance and angles — the
  latter would satisfy "the target is in the right place" and quietly re-derive
  the rotation.
- **The viewing distance is unchanged**, so a click does not alter zoom.
- **`controls.update()` is required, not tidiness.** `MapControls` caches the
  camera's offset from the target in spherical coordinates and re-applies it on
  the next frame; without the call, the next frame restores the pre-recentre
  position and the fix appears to do nothing.
- **It is called on a POSITION change, not on every render** — that is when the
  point of interest moves.
- **No animation** — the notes ask for the invariant, not a transition, and an
  animated move would need the permanent rAF loop DEC-R3-9 deliberately removed.
- **The `y = 0` pivot plane is untouched.** DEC-R3-6 left that open on purpose;
  it is a separate and much smaller effect. The caller passes `y: 0` and maps
  ENU north to `-z`.
- **The 2D map's scroll DOES drive this, since DEC-L4 (2026-08-23).** It was
  declined in the earlier notes — "moving the two views independently is
  wanted" — and the seventeenth field session asked for the reversal: a user
  drag of the map recentres the camera through this function, the same way a map
  click already did. Only a **user** gesture does; programmatic pans are filtered
  out by [`map-drag-latch.ts`](./map-drag-latch.ts.md), because two of them aim
  the camera themselves and would be undone.

## Examples

```ts
// In BuildingView, on a position change — `userEnu` is ENU in the SCENE's
// frame, i.e. relative to the anchor, not to the user's own position.
recentre(userEnu: { readonly x: number; readonly y: number }): void {
  recentreOn(this.camera, this.controls, { x: userEnu.x, y: 0, z: -userEnu.y });
  this.requestFrame();
}
```

## Tests

`recentre-camera.test.ts` (jsdom, per-file environment, real `MapControls` —
which needs a DOM element but no WebGL context): the target returns to the
origin after a pan; the quaternion is unchanged to 12 decimal places; the
viewing distance survives; the camera moves by exactly the target's offset; an
already-centred target is a no-op, so a click without a preceding pan does not
nudge the view; and — the cases that pin the fixed-frame behaviour — the pivot
lands on the **user** rather than the scene origin, the orientation survives
recentring on a moved user, and a pivot already on the user is a no-op.
