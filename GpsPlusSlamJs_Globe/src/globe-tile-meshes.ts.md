# globe-tile-meshes.ts

## Purpose

The two tile helpers both ground carriers share: the globe's surface
(`globe-surface.ts`) and the relief (`globe-terrain.ts`).

They sit in their own module for the bundle's sake. A bundler splits code by
module, never inside one, so while the relief imported them from
`globe-surface.ts`, a page drawing only the relief (the Tour Viewer's
OrbitControls editor) shared that whole module, with the imagery factory,
the cloud shell and the stars, with the page that draws the globe. The Tour
Viewer's `editor3d-lazy.test.ts` holds the split ("holds the globe's
whole-Earth imagery only in the globe view's chunks").

## Public API

- `tileMeshes(root)`: every mesh under `root`, its material typed as
  `THREE.Material`. Never throws; an empty array for a tree without meshes.
- `litCopy(template)`: a clone of the patched `template` that keeps its
  `onBeforeCompile` and `customProgramCacheKey` (`Material.copy` does not
  carry them, and the patch would be lost without an error).

`globe-surface.ts` re-exports both, so its importers keep working.

## Invariants

- No import but three: the module must stay light, or the split above is
  lost again.
- Neither compile hook uses `this` (applyGlobeSurface assigns arrow
  functions), so sharing the template's hooks is safe.

## Example

```ts
for (const mesh of tileMeshes(model)) mesh.material = litCopy(template);
```

## Tests

`globe-surface.test.ts`, "litCopy and tileMeshes (shared with the relief
carrier)", through the surface's re-export.
