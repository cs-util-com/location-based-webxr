# Component 10 — Authoring tools

The tools the author uses while physically walking the route (TASK.md §2.3):
drop a waypoint at the current GPS position with its proximity radius,
attach assets (sprite/model/audio) to it, and record the breadcrumb trail by
walking between waypoints. **Only the editing logic that emits a valid
`tour.json` + asset list** — the onboarding gate (component 9) and
packaging/QR (component 5) stay separate; wiring all three into the full
Authoring mode is a Goal-2 composition step (§2.4), not part of this
component.

This component is deliberately thin: the store (component 3), packaging's
filename convention (component 5), and the cloud-loader's ref-counted asset
provider (component 6) already do the heavy lifting — see
[`plans/2026-08-07-authoring-plan.md`](../../../plans/2026-08-07-authoring-plan.md)
for the full reuse table and decisions (AU1–AU10).

## Run it

```bash
pnpm dev            # then open http://localhost:8185/src/components/authoring/
```

Pick **Live GPS** (real device) or **Replay a Task 1 walk** (the real
recorded outdoor walk from Task 1, replayed via play/scrub controls — the
RAW GPS fixes, not a fused path, so the trail sampling is proven against
genuine device jitter). The page is organized into four sections —
**Position** (mode toggle, live status, and a read-only map showing the
position dot and dropped waypoints), **Tour Details**, **Waypoints**, and
**Export**. Click **Drop Waypoint** as the position moves; each dropped
waypoint gets its own card with labeled radius fields, one labeled file
input per model/sprite/audio slot (showing the attached filename once
picked), and a transcript textarea for the floating story text; click
**Export & Pack** to produce a real `tour.zip` via component 5's `packTour`
— load it in the cloud-loader or ar-scene demo to see it play back.

**The map is component 7's, composed in read-only for visualization only**
(labeled as such on the page) — it is not part of component 10's own
scope; see `plans/2026-08-07-authoring-demo-ux-plan.md` (decisions U2/U3)
for why and how it's wired in from `demo.ts` alone, without
`authoring-session.ts` or `authoring-view.ts` knowing it exists.

## Layout

| Path              | What lives here                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `demo.ts`         | Standalone demo entry: live/replay position source toggle, a minimal store over the real `authoringReducer`, the read-only component-7 map composition, and export → `packTour`.   |
| `index.html`      | The demo's page (loads `demo.ts`); the four-section layout + card/status styling.                                                                                                  |
| `demo-track.json` | Precomputed RAW GPS fixes from the Task 1 recording (`scripts/make-authoring-demo-track.mjs`) — same recording as components 4/7/8's demo tracks, different data (raw, not fused). |
| `core/`           | Pure, framework-free logic — id generation, breadcrumb sampling, asset-entry construction, validated export. No browser APIs. See `core/README.md`.                                |
| `view/`           | The GPS/asset-provider adapters, the session orchestrator, and the DOM view. See `view/README.md`.                                                                                 |

## Data flow

```
live GPS fix / replayed point ─▶ PositionSource ─▶ AuthoringSession
                                                       │
                          ┌────────────────────────────┼─────────────────────────┐
                          ▼                             ▼                         ▼
                 dropWaypoint() dispatches      every fix past           attachAsset() registers
                 addWaypoint at the latest       MIN_BREADCRUMB_DISTANCE_M  the File + dispatches
                 known position                  dispatches               attachAsset
                                                  addBreadcrumbPoint

exportTour() ─▶ buildValidatedExport (selectExportedTour + validateTour) + the registered File map
             ─▶ ready for component 5's packTour(tour, assetFiles)
```

## Tests

Pure logic in `core/` is unit-tested (`*.test.ts`, `pnpm test:unit`).
`view/` is unit-tested with mocked framework calls and a hand-rolled fake
store/`PositionSource` (`@vitest-environment jsdom` for the DOM view). One
replay e2e (`view/authoring-session-replay.e2e.test.ts`) feeds the real Task
1 recording's raw GPS fixes through the session and asserts the sampled
breadcrumb trail and dropped-waypoint positions against real data — the
second test level TASK.md asks for.
