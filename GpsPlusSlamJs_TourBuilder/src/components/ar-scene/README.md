# Component 8 — AR viewing scene

The Three.js/WebXR side of viewing mode (TASK.md §2.3). It turns a loaded tour
into anchored world-space content and drives it from the store: knights that
load invisibly while the visitor is still far away and appear when they get
close, tap-to-play stories with a floating transcript, a trail of glowing
breadcrumb orbs for the last approach, and a single wayfinding arrow/ring
guiding toward the nearest not-yet-visited breadcrumb, advancing on arrival
(plans/2026-09-17-breadcrumb-wayfinding-plan.md).

It **composes** the earlier components rather than reinventing them — component
1's audio player, component 2's in-world text, component 3's store contract,
component 4's proximity machine, component 6's asset provider. Its own new work
is the three things nobody else owns: **geo→world anchoring of the tour**,
**tier-2 memory** (parsed GLTF + GPU handles), and **the trail**.

## Run it

```bash
node scripts/make-ar-scene-fixtures.mjs   # once — generates public/ar-scene/*
pnpm dev                                  # then open http://localhost:8185/src/components/ar-scene/
```

A real Task 1 walk replays on the desktop: press Play and the visitor marker
follows the recorded route while knights prefetch at 25 m, appear at 10 m and
are released again on the way out. Tap one to hear its story. The HUD shows the
invariants live — per-waypoint zone and load state, LRU occupancy, parse-queue
depth, and outstanding asset references (which must return to zero).

The demo is **desktop-only** by design (plan A23): the permission/enter-AR flow
is component 9's job, and building it here would mean writing component 9 badly
and throwing it away at composition. Component 8's contract is "I take an
injected scene, camera and ray source", so the AR path is a substitution, not
new logic. `demo-walk.json` (component 4's track) is already world-space, so the
demo injects an identity anchor factory; the real `GpsAnchor` needs an alignment
matrix and GPS zero reference that only exist inside an AR session.

## Layout — three layers, not the usual two

| Path                     | What lives here                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `core/`                  | Pure functions and reducers. No THREE, no DOM. See `core/README.md`.                                          |
| `runtime/`               | The orchestrator: presenters, lifecycle, dispose ordering, driver wiring. Stateful, but **no THREE, no DOM**. |
| `view/`                  | The one real `SceneAdapter` + everything THREE-specific. See `view/README.md`.                                |
| `config.ts`              | Every budget the component relies on, all overridable per instance.                                           |
| `demo.ts` / `index.html` | The standalone demo described above.                                                                          |

**This deviates from the repo's `core`/`view` convention on purpose** (plan A20).
TourBuilder has no browser runner and no WebGL — its e2e tests are vitest in
Node. Under a plain two-layer split, the code that decides _when a knight
appears_ would live in a WebGL file and could not be tested at all, and the
"replay e2e" TASK.md §2.4 asks for would degenerate into re-testing components
3+4. With the port, the replay test drives the **real** store, **real**
proximity driver and **real** orchestrator against a recording fake adapter, and
asserts the §2.4 property directly. A `dependency-cruiser` rule
(`ar-scene-runtime-not-to-three`) enforces the boundary; type-only imports are
allowed, exactly as component 4's pure core does for `Vector3`.

## Contract

Reads the `tour`, `tourProgress` and `zones` slices through
`src/store/selectors.ts`; dispatches `initZones`, `setWaypointZone` (via the
proximity driver) and `markWaypointVisited`. Assets flow through the injected
`AssetProvider` (contract D14) — never the store. Distance is horizontal X/Z
(D17), hysteresis is component 4's (D16), and geo coordinates appear only in
`tour.json` and the single anchoring step (§2.5.1).

Two decisions worth knowing before reading the code:

- **"Visited" means _reached_, not _heard_** — dispatched on the first `ACTIVE`
  edge (plan A18). It is the only trigger that also works for content-free
  breadcrumb stops, and it matches what component 7's map already documents.
- **The LRU softens the contract's zone table.** Contract §2.5 says "IDLE →
  dispose GPU + release Blob"; this component does "IDLE → drop the clone;
  **eviction** → dispose + release" (plan A9), which is what TASK §2.5.5 asks
  for. Still bounded — at most `MODEL_LRU_CAPACITY` templates survive, and
  `dispose()` frees every one.

## Tests

Three levels, all under `pnpm test:unit`:

- **Unit** (`core/`) — zone diffing, trail windowing, the async race cases, LRU
  eviction and ref-counting, the parse-queue cap, story exclusivity.
- **Orchestrator** (`runtime/tour-scene.test.ts`) — the real store + driver +
  orchestrator against `FakeSceneAdapter`.
- **Replay e2e** (`runtime/tour-scene-replay.e2e.test.ts`) — a real Task 1
  recording, with geometry-derived assertions: ordering (build before show),
  balance (zero outstanding asset refs after `dispose()`), agreement with the
  true minimum distances, and bounded resources.
- **jsdom view** (`view/three-scene-adapter.test.ts`) — real THREE objects, no
  WebGL: shared-geometry cloning, the `userData` parent walk, pick-target
  policy, audio readiness.

See `plans/2026-07-31-ar-scene-plan.md` and `plans/Shared-Contract.md`.
