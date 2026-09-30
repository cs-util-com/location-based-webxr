# object-pick.ts

## Purpose

Selecting a placed object in AR (authoring plan 2026-09-28-0953 §3.4,
owner decision D7): a ray from the camera through the screen centre -
where the reticle ring sits - cast against the objects' own geometry.

## Public API

- `pickObject(camera, targets): string | null` - `targets` maps each
  object id to its rendered root (`RenderedTourObjects.root`); returns the
  id whose root is an ancestor of the NEAREST hit, or null on a miss or
  with no targets.

## Invariants & assumptions

- **Not the reticle's hit point**: that lies on a surface, while a pin's
  label floats above its surface, so "the object nearest the hit point"
  picks wrongly whenever two objects stand close (cold review #11). The
  ray hits the label sprite or the photo plane itself.
- The raycast is the framework's `raycastPointer`
  (`visualization/pointer-picking`, DEC-H3), which sets the raycaster's
  camera - three's `Sprite.raycast` requires it.
- The camera's world matrix must be current; in an immersive session the
  WebXR manager keeps it so (the seam passes the framework's camera).
- The screen centre, not the tap point: the tap's own ray would need the
  XR input source's pose in the scene's frame. The overlay says "aim the
  ring at a pin or photo and tap".

## Examples

```ts
const id = pickObject(getCamera(), new Map([["pin-1", preview.root]]));
```

## Tests

`object-pick.test.ts` - with real three.js objects: a label's sprite, a
photo's plane, the nearest of two on the ray, a miss, and a hit nested
under its root. The e2e scene is a stub with no geometry, so this is the
only place the ray meets real objects; the e2e covers the wiring through
the `pickObjectInView` seam.
