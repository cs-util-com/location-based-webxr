# Component 11 — desktop preview

Walks a real tour on a desktop, with no phone, no GPS and no WebXR — and with
**no scene-side branching**: component 8's AR viewing scene runs unchanged
inside a stand-in for the AR session. What a visitor (or an author checking
their work) sees here is the real tour, not a mock-up.

Demo: `pnpm dev` → <http://localhost:8185/src/components/desktop-preview/>

The demo mounts the same furniture the composed viewing app does: the shared
HUD (`src/components/shared/hud.ts` — Map, Auto-walk, Buildings; no End-tour,
this single-page demo has nothing to end back to) and component 7's 2D map
(`createTourMap`), floated top-right and kept in sync with the walked
position and visited waypoints via `buildMapData`/`computeMarkerViewModels`
— the same functions `viewing-app.ts` calls.

```
             ┌── preview session ────────────────────────────┐
 keyboard ──►│ walk simulator ─► camera ─► seams ─► AR scene │──► the same
 breadcrumb ►│ route follower           (pinned frame)       │    component 8
             └───────────────────────────────────────────────┘
```

## Why it works

`startArScene` (viewing composition) already takes its world through two
injected surfaces: an `ArRuntime` (world group, camera, XR session, frame
loop, alignment selectors) and the geo→world **seams** (`createAnchor`,
`toWorld`, `getUserWorldPos`). A phone fills both from `initAR` and GPS
alignment. This component fills both from a plain Three.js scene:

| Live session                           | Preview                                         |
| -------------------------------------- | ----------------------------------------------- |
| `arWorldGroup` from `initAR`           | a `Group` in a local scene                      |
| pose-tracked camera                    | a walkable first-person camera at 1.6 m         |
| alignment matrix, converging over time | identity, pinned from frame one                 |
| GPS zero reference                     | the tour's own origin (`computePreviewStart`)   |
| XR `select` ray                        | pointer raycast against the canvas              |
| the visitor's legs                     | W A S D + drag-to-look, or breadcrumb autopilot |

Because the alignment is pinned, `isFullyAnchored` is true immediately — the
two failure modes `src/app/viewing/ar-seams.ts` documents (bootstrap stealing
the coordinate, a raw anchored flag activating the whole tour at entry) cannot
arise here.

## Modules

| Path                         | What lives here                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/walk-simulator.ts`     | Pure locomotion: forward/strafe/turn/run → a pose in GPS-world NUE metres. Diagonals are normalised, not summed.                                                                                                                                                                                                                                                            |
| `core/route-follower.ts`     | Pure autopilot along the breadcrumb; carries leftover distance across corners, skips zero-length segments.                                                                                                                                                                                                                                                                  |
| `core/preview-frame.ts`      | The pinned geo↔world frame, via the framework's own `calcRelativeCoordsInMeters` / `calcGpsCoords`.                                                                                                                                                                                                                                                                         |
| `core/preview-start.ts`      | Where a preview of a given tour begins, and which way the visitor faces. Also exports `tourStartCoord` — the tour's start (trailhead, else first stop) — which the viewing entry screen measures the visitor's distance against.                                                                                                                                            |
| `view/preview-session.ts`    | The session: scene, sky, ground, lights, fog, camera, frame loop, and the `ArRuntime`-shaped runtime.                                                                                                                                                                                                                                                                       |
| `view/preview-seams.ts`      | `createAnchor` / `toWorld` / `getUserWorldPos` for the pinned frame.                                                                                                                                                                                                                                                                                                        |
| `view/preview-controls.ts`   | Keyboard + drag-to-look → `WalkInput`. Look deltas accumulate and drain per sample.                                                                                                                                                                                                                                                                                         |
| `view/osm-building-layer.ts` | Real OSM buildings, fetched once (live `OverpassSource`, 300 m radius, 20 s timeout) around the tour's origin and dropped flat onto the ground. Desktop-preview only — never imported by `ar-scene`/`app/viewing` (enforced by a dependency-cruiser rule). Fails soft to the flat plane on any error/timeout; see `plans/2026-08-27-desktop-preview-osm-buildings-plan.md`. |

## Two things that are easy to get wrong

1. **Where the preview starts.** Standing the visitor on the first waypoint
   activates (and completes) the whole tour in the first second; facing them
   away from it shows an empty field. `computePreviewStart` starts at the
   author's trailhead when the tour has a breadcrumb, and otherwise stands
   back 18 m from the first stop, looking at it.
2. **The canvas belongs under the HUD.** It stands in for the camera feed, so
   it is inserted as the AR container's first child and the session takes it
   back on `dispose()` — the HUD and map keep their own z-layers.

## Tests

Pure cores are unit-tested; the session and the controls run in jsdom with the
renderer, the clock and the controls injected, so everything except the WebGL
draw call is covered:

```bash
pnpm exec vitest run src/components/desktop-preview
```
