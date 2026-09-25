# ar-scene/runtime — the orchestrator

Stateful and effectful, but **THREE-free and DOM-free**: every rendering effect
goes through the `SceneAdapter` port. That is what lets the real store, the real
proximity driver and this exact code run in Node against a recording fake — the
replay proof TASK.md §2.4 asks for, in a package with no browser runner.

A `dependency-cruiser` rule (`ar-scene-runtime-not-to-three`) enforces it. Type-only
imports of `Vector3` are allowed: positions are produced by the adapter and
passed through, never constructed here.

## Modules

### `scene-adapter.ts` — the port

Opaque handles (`WaypointHandle`, `TemplateHandle`, `VisualHandle`) and the
methods the orchestrator needs: anchoring, template build/dispose, clone
instantiate/release, visibility, transcript, audio, orbs, pick targets, taps.
A port handing back `THREE.Object3D` would buy nothing, hence the handles.

### `tour-scene.ts` — `createTourScene`

Owns the tour lifecycle. Subscribes to the store, anchors every waypoint,
constructs the proximity driver (component 8 holds the anchored positions, so it
is the only sensible owner — plan A2), diffs `zones` into commands, windows the
trail four times a second, routes taps into the story session, and tears
everything down.

- **`tick(dt)` does not self-register** with the framework frame loop by default
  (plan A21, mirroring `wayfinding-hud`'s `autoRegisterFrameUpdate: false`):
  deterministic under test, one obvious call site, no double-tick.
- **Re-entrancy**: the driver dispatches during `tick`, and executing a command
  dispatches `markWaypointVisited` — both re-enter the store listener. The
  outermost `syncZones` drains changes in a loop instead of recursing.
- **Tour change → full rebuild** (plan A22), not an incremental diff.
- **`dispose()` is ordered and idempotent**: stop audio → unsubscribe → drain the
  queue → invalidate in-flight loads → dispose presenters → clear the cache
  (which releases the asset refs) → detach listeners → dispose the adapter. The
  headline invariant is that outstanding asset references are **zero** afterwards,
  including when disposal happens mid-parse.

### `waypoint-presenter.ts` — one waypoint

The anchored root and its GPS anchor live for the whole tour (the driver needs a
stable position even at IDLE — that is how a waypoint ever leaves IDLE); only the
heavy children follow the zone. Executes the pure lifecycle's intents and owns
the two ref-counted resources: the model template (via the loader) and the audio
blob (taken on first tap, released at IDLE — plan A17).

### `template-loader.ts` — one asset

The shared owner of the LRU, the parse queue and **in-flight de-duplication**.
Two waypoints sharing a model and crossing the prefetch line together would
otherwise fetch and parse the same GLB twice. `invalidate()` abandons in-flight
work on tour change or teardown: a load landing afterwards frees itself instead
of entering a cache nobody will ever evict from.

### `fake-scene-adapter.ts` — the recording stand-in

Not just a spy: it tracks anchoring, template and clone lifetimes so the leak and
ordering invariants are asserted directly. Ships with `createCountingAssetProvider`,
which throws on a double release — the check that would catch a mistake in the
"only a resolved `getAssetUrl` may be released" rule.

## Tests

`tour-scene.test.ts` covers the wiring (zone lifecycle, LRU behaviour through the
real orchestrator, soft-fail, story session, audio gate, trail, dispose).
`tour-scene-replay.e2e.test.ts` replays `recordings/2026-06-22_16-06-59utc.zip`
and asserts four geometry-derived properties: build-before-show, zero outstanding
refs after dispose, visibility matching the true minimum distances, and bounded
templates/parses.
