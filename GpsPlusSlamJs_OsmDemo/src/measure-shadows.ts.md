# measure-shadows.ts

Purpose: the building-shadow measurement (`?measure=shadows`), a throwaway runner on a spike branch that never merges. Once the city has not rebuilt for 8 s it times cached sun shadows on the city through the page's real sun slider and on-demand frame loop, then shows a "Copy log" button with a plain-text report (a selectable text box when the clipboard is refused). Afterwards the default configuration stays on for a look check.

## Public API

- `shadowMeasureRequested(search)`: true for `measure=shadows`.
- `startShadowMeasure({handles, hooks, slider, scheme, chooseScheme})`: mounts the panel, installs the two-map chunk rewrite and, once the city is quiet, the frame and sun-step hooks; returns `{ meshDrawn(mesh) }`, which `onMesh` calls for every full mesh.
- `quantile(values, q)`: nearest-rank quantile.

## What it logs

- Device: user agent, GPU string, canvas size and pixel ratio, `MAX_TEXTURE_SIZE`, `MAX_FRAGMENT_UNIFORM_VECTORS`, `MAX_VARYING_VECTORS`, `MAX_TEXTURE_IMAGE_UNITS`; the shadow map's `FRAMEBUFFER_ATTACHMENT_DEPTH_SIZE`.
- The city: building chunks and triangles, tree meshes and instances, its centre, half extent and tallest building.
- Frame time with shadows off; the compile of one shadow (first synchronous frame) and of two (`compileAsync` hold, link errors).
- Forced map renders per configuration (one map 2048/1024, near plus far 2048/2048, 2048/1024, 1024/1024) at sun 40, 10 and 3 degrees, with draw calls and triangles; trees casting and `DoubleSide` shadow sides.
- The whole sun step W per configuration: the slider's handler (sky, light, atmosphere) plus the frame or frames that render the maps, in the current look and in the other look (fixed vs time of day), with band verdicts at 33, 50 and 60 ms.
- A 40-input slider drag per cadence and `sunUpdateDeg` setting; a 20-step sun descent from 6 to -6 degrees with long tasks.
- ABAB blocks of receive-on and receive-off frames (the per-frame sampling cost) with the A-A spread, doubled when the spread hides the difference.
- Scripted out-and-back pans for k 0.75, 1, 1.5 x re-centre 0.25, 0.5 x every re-centre or on settle, each way 8.5 x 0.5R; the worst case for D (target at the city edge away from the sun, sun at 3 degrees); a zoom across three or more near steps.
- Shadow map memory per configuration (8 B per texel).

## Knobs after the run

`shadowF` (depth-fade start), `shadowK` (near fit), `shadowSide=double`, `shadowTrees=1`.

## Invariants

- Timing uses a GPU sync (a one-pixel read of the canvas) at the end of each frame and after each sun-step handler.
- `renderer.info` is reset at each frame start, so draw calls include the shadow passes.
- The two-map rewrite is inert with fewer than two shadow-casting lights.

## Tests

None: a spike that never merges. Its numbers go into the results document.
