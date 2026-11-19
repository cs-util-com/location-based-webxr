# editor3d-view.ts

## Purpose

The contract between the editor page (`../editor/edit-main.ts`) and its
3D view on the globe (`editor3d-globe.ts`): what the page hands the view,
what the view hands back, and the figures it reads out. Types only, so the
page, the shell (`../editor/editor-shell/editor-shell.ts`) and the bottom
panel (`../editor/editor-shell/bottom-panel.ts`) can name the view without
loading it: the view itself arrives by a dynamic `import()`.

## Public API

- `Editor3dDeps` - what the page hands the view: the box (`container`) and
  the credits' box, the store (read for the tour and the selection,
  written for a gesture's start and end), the open tour's codes
  (`levels`) and content (`loadContent`), the failure events after the
  view shows (`events.contextLost`, `events.failed`), the page's edits
  (`edits`: commit, select, remove, duplicate, say, the ground menu, a
  model's own edit, whether a key is free), the optional approach (with
  its `ended` callback), the recorded walk (`walk`) and the debug
  layer's thumbnails (`debugThumbs`, `debug-thumbs.ts`). The store it
  reads may carry the `debugLayer` slice (`debug-layer-slice.ts`); a
  page without it draws no debug layer.
- `Editor3dView` - the shown view:
  - the camera's verbs the shell and the page's checks use: `flyTo`,
    `lookFrom`, `frame`, `setTop`, `zoom`, `northUp`, `setTilt`,
    `setDistance`, `setHeading` (round the point the line of sight
    meets, keeping the distance to it and the tilt);
  - the drawing's switches: `setPaused`, `setLayers`, `setRealTime`,
    `setClouds` and `setBuildings` (every view has them: the globe is the
    only 3D view);
  - edits through the page: `turn`, `previewRadius`, `cancelGesture`;
  - reads: `readout` (the shell's compass, Top view item and bottom
    panel), `stats` (the page's checks), `mapTiles`, `retryMap`,
    `lastMapRetry`, `centre` (null where the view has no ground to give),
    `pointOf`, `groundAt`, `origin`, and the checks' screen reads
    (`screenOf`, `handleScreen`, `underAt`, `gizmoSizes`, `modelParts`,
    `folderOutlines`, `modelScreenOf`, `characterCheck`,
    `showSoundIcons`);
  - `dispose`.
- `Editor3dReadout` - tilt, heading, Top view, draw calls, triangles,
  the frame times (`frame-clock.ts`) and the street map's loading state.
- `Editor3dStats` - the page's checks' figures: frames, clip planes, field
  of view, stations and codes, each code's scale and drawn side
  (`codePx`), the tour's centre (`target`, in the tour's frame), where the
  line of sight meets the ground (`look`) and the camera (`camera`), both
  in the world, the distance, flying, Top view, each station's drawn
  height over its ground, and the globe's own (`globe`) and buildings'
  (`city`) figures.

No function, so no error modes of its own; the view's open rejects with
a `viewFailure` (`editor3d-view-parts.ts`).

## Invariants & assumptions

- **Read world points in one call:** the globe's world frame follows the
  camera, so `look`, `camera` and `pointOf` compare only within one read;
  `stats().globe.pose` is the camera's identity across reads.
- **Type-only imports:** nothing here loads three, the globe or the
  view's code; `editor-shell.ts` and `bottom-panel.ts` stay light.
- The store the view reads (`Editor3dStore`) is the page's Redux store,
  narrowed to the tour document and the editor's view state.

## Examples

```ts
import type { Editor3dDeps, Editor3dView } from "../editor3d/editor3d-view.js";

const { openGlobeEditor } = await import("../editor3d/editor3d-globe.js");
const view: Editor3dView = await openGlobeEditor(deps, knobs);
view.setHeading(90);
const { look, camera } = view.stats(); // one read: one frame
```

## Tests

Types only: `pnpm run typecheck` holds every implementer and caller to
them. The verbs' behaviour is tested where they are implemented
(`editor3d-globe.test.ts`, for example "turns to heading ... round the
point it looks at") and in the editor's e2e specs through the page's test
hook (`window.__tourEditor`).
