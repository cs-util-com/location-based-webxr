# authoring/view — the browser-facing adapters, orchestrator, and DOM view

## `gps-position-source.ts`

```ts
interface PositionSource {
  subscribe(onPosition: (pos: TourCoord, fix?: FixInfo) => void): () => void;
}
createLiveGpsPositionSource(deps?): PositionSource
```

The only place this component touches the framework's browser-only GPS
watch directly. `startGpsWatch`/`stopGpsWatch` is the framework's only
"current position" primitive — no Redux selector exists for it, only a
history of past fixes. The demo's replay mode and every test supply their
own trivial `PositionSource` instead (plan AU6), so the orchestrator below
never knows or cares whether a fix is live or replayed. The live source passes
each fix's `accuracy` and `timestamp` as the optional second argument
(`FixInfo`, from `core/breadcrumb-gate.ts`); a replay source may omit it.

## `files-asset-provider.ts`

```ts
interface FilesAssetProviderHandle {
  readonly provider: AssetProvider;
  registerFile(id: AssetId, file: File): void;
}
createFilesAssetProvider(overrides?): FilesAssetProviderHandle
```

The authoring-mode `AssetProvider` backing (contract D14d) — a thin wrapper
over component 6's `RefCountedAssetProvider` owning only a `Map<AssetId,
File>`. No new ref-counting/retry logic (plan AU7).

## `authoring-session.ts`

```ts
createAuthoringSession(deps: AuthoringSessionDeps): AuthoringSession
// dropWaypoint(): string | null
// attachAsset(waypointId, slot, file): void
// exportTour(): { tour: Tour; assetFiles: ReadonlyMap<AssetId, File> }
// destroy(): void
```

The orchestrator: subscribes to the injected `PositionSource` once, tracks
the latest fix for `dropWaypoint()`, and runs every fix through
`createBreadcrumbGate` (accuracy, implied speed, minimum spacing from the last
_dispatched_ breadcrumb point). `dropWaypoint()` with no argument — a waypoint at
the live fix — also re-anchors the gate there; `dropWaypoint(position)` (map
click / drag) does not, since it says nothing about where the author stands.
`attachAsset` registers the file with the asset-provider handle **before**
dispatching, so a listener reacting to the dispatched action can already
resolve it. `destroy()` unsubscribes and self-guards against any fix that
arrives after teardown.

## `authoring-view.ts`

```ts
mountAuthoringView(root: HTMLElement, deps: AuthoringViewDeps): { destroy(): void }
```

DOM wiring only — no logic of its own. Renders three sections: **Tour
Details** (labeled name/description inputs → `setTourMeta`), **Waypoints**
(a Drop Waypoint button → `session.dropWaypoint()`, then either an
empty-state message or a card per waypoint — a numbered heading with the
real id as a secondary badge, labeled radius inputs → `updateWaypoint`, a
remove button → `removeWaypoint`, one labeled row per asset slot, and a
transcript textarea → `updateWaypoint({changes: {content: {transcript}}})`
— the reducer merges `content` rather than replacing it, so editing the
transcript never clobbers an attached model/sprite/audio), and **Export**
(→ `session.exportTour()`, forwarded to the injected `onExport`). Reacts to
store changes via an injected `subscribe`/`getState` pair rather than
owning state — the `authoring` slice (component 3) is the single source of
truth. `destroy()` unsubscribes and clears the DOM.

The transcript field is the one piece of `WaypointContent` that isn't asset-
backed (contract D4 — it's inline text, not a file) and was missing from
the original implementation; the store side (`updateWaypoint`) already
supported it from component 3 onward.

**Attached-asset filenames are read from `waypoint.content` / `authoring.
assets`, never from a native `<input type="file">`'s own "chosen file"
label.** Every store change rebuilds every file input from scratch, which
would otherwise silently reset that native label to empty even though the
asset is still attached underneath — a real bug fixed by treating state as
the only source of truth for what's displayed (plan
`2026-08-07-authoring-demo-ux-plan.md`, decision U5).

## Tests

`gps-position-source.test.ts` and `files-asset-provider.test.ts` — mocked
framework calls / fake `createObjectUrl`. `authoring-session.test.ts` —
mocked `PositionSource`/`dispatch`. `authoring-view.test.ts`
(`@vitest-environment jsdom`) — a hand-rolled fake store, no Redux
dependency; includes the empty-state and attached-filename-survives-
re-render (U5) cases. `authoring-session-replay.e2e.test.ts` — the replay
e2e (see the root README).
