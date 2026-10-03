# globe-lazy-height-scale.ts

## Purpose

The relief's height-scale step without a whole-tree walk. The library's
terrain plugin (`TerrainRGBMeshPlugin._updateHeightScale`, 3d-tiles-renderer
0.5.3) rebuilds the bounding volume of every node it ever made on each change
of `heightScale`: a new `EllipsoidRegion` and `OBB` per node, and the tree is
never pruned. The frame-hitch recorder counted 6,614 nodes at the first E step
of one descent and 19,926 at the last; at 5-14 us a node that is one long
frame per step (perf plan
[2026-10-03-2017](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-10-03-2017-globe-zoom-frame-hitches-performance-plan.md)
H1, PERF-2b option A, DEC-PERF-4).

## Public API

- `installLazyHeightScale(tiles, plugin): LazyHeightScale`
  - `tiles`: the relief's `TilesRenderer`; `plugin`: its registered
    `TerrariumMeshPlugin`. Call once, after `registerPlugin`, before any tile
    exists.
  - Replaces, on these two instances only: `plugin._updateHeightScale`,
    `plugin._updateBoundingVolume` (wrapped, stamps the scale version it
    used) and `tiles.calculateTileViewError` (wrapped, refreshes a stale
    volume first).
  - Returns `stats()`: `lastStepRefreshes` (volumes refreshed at the last
    scale change), `deferredRefreshes` (refreshed on read since install),
    `scaleChanges`.
  - TypeError when the plugin or renderer lacks a member it relies on (a
    library upgrade renamed it).

## Invariants

- The caller still sets `plugin.heightScale`; the library's setter calls the
  replaced method through `this`, so nothing else changes.
- A scale change sets the new scale on every loaded material at once, and
  refreshes at once only the volumes whose tile the last `update()` visited
  (`traversal.lastFrameVisited === tiles.frameCount`): those are the ones a
  raycast reads before the next update.
- Every other volume is refreshed just before the renderer next computes its
  view error, once per scale change however often it is read.
- No volume is ever read by the traversal at a stale scale; the drawn result
  equals the library's eager path. Only the cost moves: a step costs the
  visited count plus a field compare per node, not a volume rebuild per node.

## Example

```ts
const plugin = new TerrariumMeshPlugin({ url, heightScale: 1 });
tiles.registerPlugin(plugin);
const lazy = installLazyHeightScale(tiles, plugin);
plugin.heightScale = 2.4; // visited volumes now, the rest on their next read
```

## Tests

`globe-lazy-height-scale.test.ts`: materials at once; only visited volumes at
the step (37 of 20,000); a stale volume refreshed before its view-error read;
one refresh per scale; no work for an unchanged scale; a fast-check property
over random visits and E steps (no stale read, a step never costs more than
the visited count); the TypeError; and a guard on the library members it
relies on (the two plugin methods, the setter's `this._updateHeightScale()`,
`calculateTileViewErrorWithPlugin` calling `this.calculateTileViewError(`,
and `lastFrameVisited = renderer.frameCount` in the traversal).
