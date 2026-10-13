# selection-mark.ts

## Purpose

The selected object's mark in the AR scene (polish round M3, B2: the
owner wants to tap an object and see it selected). An accent ring lies
flat at the object's anchor - for a pin, the surface point it stands on -
as in the owner's chosen HUD prototype H1 (`public/prototypes/hud-1-chips/`).

## Public API

- `createSelectionMark(): SelectionMark` - one ring mesh, reused.
  - `show(root: Object3D | null)` - ring the object of `root` (a preview's
    group from `renderTourObjects`: one object at its anchor), or take the
    ring away with null. Idempotent for the same group; a different group
    (another object, or the same object's preview redrawn by a move) gets
    the ring anew. A group with no object (a photo that failed to decode)
    gets none.
  - `dispose()` - takes the ring away and frees its geometry and material.
- `SELECTION_MARK_NAME` - the ring's `name`, how tests find it.

## Invariants & assumptions

- **At most one ring exists**, and it hangs under the selected preview's
  group, so it moves, follows a code frame and is removed with it.
- The ring hangs in the preview's group but is never picked (its `raycast`
  is a no-op): a tap near a selected pin's base lets go instead of
  re-selecting it.
- Colour: the page's route red (`--map-route`, `0xcf4428`); radii 0.30 to
  0.40 m (about H1's halo, readable at 5-10 m); drawn over the object with
  the depth test off (a photo's ring sits at its capture height and would
  otherwise be half hidden by the photo plane). H1's ground halo for photos
  and its outline around the label or frame are not built: the anchor is
  the only position the preview knows.
- Driven from `creator-setup.ts`'s readout render: `show` runs on every
  render with the current selection's group, which is what keeps it on a
  preview that was redrawn.

## Examples

```ts
const mark = createSelectionMark();
mark.show(ctx.placedPreviews.get(selectedId)?.root ?? null);
mark.show(null); // the selection went
```

## Tests

- `selection-mark.test.ts` - the ring at the anchor, flat, once per
  group; moving to another group and to a redrawn one; null and dispose
  leave no mesh; an empty group gets none.
- `authoring-settle.test.ts` - through the composed setup: a tap puts the
  ring on the tapped object's preview only, Done takes it away.
