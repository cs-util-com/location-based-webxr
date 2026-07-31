# `recentre-camera.ts` — pointing the camera back at the origin

## Purpose

When the user moves, translate the camera and its orbit target so the target
sits at the scene origin again — **without rotating the camera**.

## Public API

- `OrbitTarget` — `{ target: THREE.Vector3, update() }`. A structural type
  rather than an import of `MapControls`, so the contract is "anything with an
  orbit target".
- `recentreOnOrigin(camera: THREE.Object3D, controls: OrbitTarget): void` — a
  no-op when the target is already at the origin. Never throws.

## Invariants & assumptions

- **The camera's orientation is unchanged, by construction.** Camera and target
  move by the same vector, so the camera→target offset is bit-identical and the
  quaternion cannot move. This is the requirement the round-4 notes state
  outright ("nur ihre Translation ändern"), and it is why the implementation is
  a subtraction rather than a recomputation from distance and angles — the
  latter would satisfy "the target is at the origin" and quietly re-derive the
  rotation.
- **The viewing distance is unchanged**, so a click does not alter zoom.
- **`controls.update()` is required, not tidiness.** `MapControls` caches the
  camera's offset from the target in spherical coordinates and re-applies it on
  the next frame; without the call, the next frame restores the pre-recentre
  position and the fix appears to do nothing.
- **It is called on a POSITION change, not on every render.** The scene is
  re-origined per position (`enuFrameAt(snapshot.position)`), so that is exactly
  when the origin becomes the new point of interest.
- **No animation** — the notes ask for the invariant, not a transition, and an
  animated move would need the permanent rAF loop DEC-R3-9 deliberately removed.
- **The `y = 0` pivot plane is untouched.** DEC-R3-6 left that open on purpose;
  it is a separate and much smaller effect.
- **The 2D map's scroll does not drive this.** Declined in the notes themselves:
  moving the two views independently is wanted.

## Examples

```ts
// In BuildingView, on a position change:
recentreOnOrigin(this.camera, this.controls);
this.requestFrame();
```

## Tests

`recentre-camera.test.ts` (jsdom, per-file environment, real `MapControls` —
which needs a DOM element but no WebGL context): the target returns to the
origin after a pan; the quaternion is unchanged to 12 decimal places; the
viewing distance survives; the camera moves by exactly the target's offset; and
an already-centred target is a no-op, so a click without a preceding pan does
not nudge the view.
