# Component 7 — 2D map overview

A toggleable, real-time 2D map showing the visitor's position and the tour's
points of interest (TASK.md §2.3). Plain Leaflet in a DOM `<div>` — **no
Three.js, no CSS3D** — matching the spec's own wording ("a toggleable
**HTML/2D** map") and its "standalone map page" demo.

## Run it

```bash
pnpm dev            # then open http://localhost:8185/src/components/map/
```

A real Task 1 walk replays: the position dot moves along the recorded track
and three waypoint markers recolour as the real proximity driver (component 4)
crosses their zones. "Visited" (green + ✓) means the waypoint has reached
`ACTIVE` at least once — it's driven by the actual state machine, not a fake
check.

## Why not just reuse `LeafletMapOverlay` (the recorder's live map)?

Investigated first, per the spec's requirement. `LeafletMapOverlay`
(`gps-plus-slam-app-framework/visualization/leaflet-map-overlay.ts`) IS the
recorder's real, real-time, toggleable map — but it embeds its Leaflet map
into a `THREE.Scene` via a `CSS3DObject` so it displays as a floating panel
inside an AR/WebXR scene. That's the wrong seam for a component whose own spec
line says "HTML/2D" and whose demo is "a standalone page," not a Three.js
scene. Full rationale + the documented deviation: `plans/2026-07-31-map-plan.md`.

What genuinely IS reused, at the correct seam: the framework's shared
`buildMapData`/`drawMapData` (the exact same pure builder + Leaflet-drawing
routine the live CSS3D map and the 2D session-summary map already share) for
the user-position dot, plus the public method **shapes**
(`setGpsPosition`, `render`, `toggle`/`show`/`hide`/`isVisible`) mirrored so a
future composition step could still wrap this component in a `CSS3DObject`
the same way, without changing this file's interface.

## Layout

| Path                     | What lives here                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo.ts` / `index.html` | Standalone demo. Composes the real store (3), the real proximity driver (4), and this map (7) — no fakes.                                                                                                                                                                                                                                               |
| `demo-track.json`        | The real recording's lat/lon track, precomputed via `scripts/make-map-demo-track.mjs`. Index-aligned with `../proximity/demo-walk.json`'s world-space path (both derived from the same `odometryPositions`), so the demo picks matching waypoint anchors for the map (lat/lon) and the proximity driver (world-space) with zero runtime geo conversion. |
| `core/`                  | Pure waypoint → marker-status mapping. See `core/README.md`.                                                                                                                                                                                                                                                                                            |
| `view/`                  | The plain-Leaflet map + the replay e2e. See `view/README.md`.                                                                                                                                                                                                                                                                                           |

## Contract

Map works in lat/lon (Leaflet native) — the one place besides `tour.json` and
the framework's anchoring step where geo coordinates legitimately appear
(contract D5, §2.5.1). The "next unvisited" marker highlight
(`selectNextUnvisitedWaypoint`) is a **visual hint only, not a gate** — the
proximity driver activates any waypoint by distance regardless of order, since
waypoint order is not enforced.

See `plans/2026-07-31-map-plan.md` and `plans/Shared-Contract.md`.

## Tests

Two levels (TASK.md §2.3) plus a jsdom integration layer:
`core/map-marker-state.test.ts` unit-tests the pure visited/next/unvisited
mapping. `view/tour-map.test.ts` (Leaflet mocked, same convention as the
framework's `leaflet-map-overlay.test.ts`) covers map creation, the
geo→pixel/marker placement (`setWaypoints`), per-status icon styling,
`render`'s user-dot path, toggle/show/hide, resize, and destroy.
`view/tour-map-replay.e2e.test.ts` replays a real Task 1 recording and asserts
the position marker follows the track, in order, against the framework's
already-tested `computeFusedPath` (no new geo math). Run `pnpm test:unit`.
