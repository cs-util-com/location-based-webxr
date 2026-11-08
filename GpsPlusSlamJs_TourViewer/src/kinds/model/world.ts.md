# `kinds/model/world.ts` - a placed model's part in the world

## Purpose

The adapter that puts a model's world view (`model-views.ts`
`mountModelView`) behind the one world door (`world-part.ts`). The
renderer (`content-placement.ts`) draws a model as it draws any other
kind's part, and the 3D editor (`editor3d-stations.ts`) builds it in
`edit` as the plain model (below). It is the model row's `world` (`play-kinds.ts`).

## Public API

- `modelWorld(block, env) -> WorldPart | null`
  - null for a view that stands nothing in the station's world (`card`,
    the story's `stage`; the world views are the framework's
    `TOUR_MODEL_WORLD_VIEWS`: placed, ghost, hotspots, cutaway, toy) and
    for a block with no `sizeM` (the shared scale rule needs one). No file
    is read then.
  - `object` - an empty group the renderer places at the block's pose. The
    model lands in it once `env.loadModel(block.asset)` resolves, scaled
    so its largest side is `sizeM` (`model-scale.ts` `modelScale`), and
    mounted in its view with the page's clipping switch
    (`env.enableClipping`, which a cutaway asks for); in `edit` no view is
    mounted (below).
  - `ready` - settles once the model stands; rejects with the load's error
    when the file cannot be read or parsed (the renderer names the block
    in `skipped` and takes the part out of the station: freed, unmounted,
    out of its group and count, while the station's other blocks stay).
  - `dispose()` - the view first (it gives the model back its own
    materials), then the model out of the group and freed
    (`disposeObject3D`). Both are let go before freeing: a free that
    throws leaves nothing for a second `dispose` to free again, every
    free still runs, and the first error is the one thrown. A model that
    lands after `dispose` is freed and never added.

## Invariants and assumptions

- The model's `userData` carries `tourScale` (the scale drawn, read after
  the view mounted: a toy starts smaller than its tour size) and
  `tourSizeM`. The editor scales a dragged size from these
  (`editor3d-stations.ts` `resizeModel`) and finds the model by them
  (`modelObject`, `models`).
- The scale is on the model, the pose on the group: the editor's notes and
  sections (`editor3d-model-parts.ts`) are in the model's own space and
  stay correct under both.
- In `edit` the model stands plain: at its tour size (a toy at its full
  size), in its own materials, with no view mounted, so no clip plays and
  no clipping is asked for. The editor drives no frame of a view (a
  ghost's ground height, a clip) and switches no clipping on, so a view
  mounted there would show a half-made look; it is how the editor drew
  models before they came through the door. `play` wears the view.
- The part never touches the scene, the camera or the frame loop; the
  view's handle is found again through `mountedModelViews`
  (`model-visitor.ts` drives its gestures and frame tick).

## Example

```ts
const env = worldEnv("play", manifest.assets, loadContent, {
  parseModel: (blob) => loadGlbModel(blob),
  enableClipping: () => (renderer.localClippingEnabled = true),
});
const part = modelWorld(block, env); // or worldPartOf(block, env)
await part?.ready;
```

## Tests

`world.test.ts`: placed at `sizeM` with its view mounted and unmounted on
dispose; null and no read for card, stage and no size; a cutaway's
clipping switch and its cut faces' materials freed exactly once, the
ghost glass freed exactly once and the model's own material restored and
freed once; a file that lands
after dispose freed and not added; a failed load rejecting `ready`; the
plain model in `edit` in every world view (no view, its own material, no
clipping, the tour size, freed once) against `play` wearing the view; a
toy's drawn scale as `tourScale`; and a
property (60 runs over box sides 0.01 to 100 m and sizes 0.05 to 50 m):
the drawn largest side is `sizeM`. The renderer's use is in
`content-placement.test.ts`, the editor's in `editor3d-stations.test.ts`.
