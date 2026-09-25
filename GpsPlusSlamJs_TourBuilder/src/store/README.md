# src/store — the shared contract (Component 3)

The single contract every subsequent component (4–10) codes against: the
`tour.json` schema types, the load-time validator, the Redux slices, selectors,
and the two store factories. **No Three.js, no DOM** — pure data + reducers, so
it runs on a desktop with no phone and is reused by both app modes.

This directory lives at the `src/` root (not under `src/components/`). Dependencies
flow **components → store** only; the store never imports a feature component
(enforced by `config/.dependency-cruiser.cjs`).

> **Selector contract:** components that read store state MUST use the selectors
> in `selectors.ts`. A component needing a new read adds it there rather than
> selecting inline, so state-shape knowledge stays in one file.

See `plans/Shared-Contract.md` for the agreed design (decisions, deviations,
rationale). This README is the code-level sidecar.

## Modules

### `types.ts` — the schema (Public API)

`Tour`, `Waypoint`, `WaypointContent`, `AssetEntry`, `TourCoord`, `AssetId`,
`AssetType`, `ZoneState`, and the `AssetProvider` interface. Copied verbatim from
`Shared-Contract.md` §1 — `TourCoord` is structurally assignable to the core
`LatLong`/`LatLongAlt` so it drops into `createGpsAnchor` with zero field mapping.
Lat/lon appears only in persisted data; runtime works in world-space metres.

### `validate-tour.ts` — the load-time gate

`validateTour(raw: unknown): Tour` — parses/validates a raw `tour.json` and either
returns a well-typed `Tour` or throws `TourValidationError`. Never returns partial
data. Enforces contract invariants: (1) every referenced asset id exists, (2) at
most one of `model`/`sprite` per waypoint, (4) ids unique within `assets` /
`waypoints`, (5) `prefetchRadius > activeRadius > 0`, plus structural/type checks.
`filename`-in-zip (invariant 3) is packaging's job; there is no `schemaVersion`
(D9).

### `parse-tour-json.ts` — the text gate

`parseTourJson(text: string): Tour` — `JSON.parse` + `validateTour` in one step.
A JSON syntax error is rethrown as `TourValidationError`, so every consumer that
starts from raw tour.json _text_ (the cloud-loader reading it out of the zip,
the packaging demo's "use your own tour" input) handles exactly one error type.
Adds no validation of its own beyond the parse step.

### `tour-slice.ts` — loaded tour (viewing)

`{ tour: Tour | null }`. `loadTour(tour)` / `clearTour()`. The reducer does not
validate — the loader runs `validateTour` first. `clearTour` is the cross-slice
reset signal (`tourProgress` and `zones` listen for it).

### `tour-progress-slice.ts` — visited waypoints (viewing)

`{ visitedWaypointIds }`. `markWaypointVisited(id)` is idempotent (safe to re-fire
from a proximity driver). Resets on `clearTour`.

### `zones-slice.ts` — proximity zone state (viewing)

`{ byWaypointId: Record<id, ZoneState> }`. `initZones(ids)` seeds all to `IDLE`;
`setWaypointZone({ id, zone })` updates one. Transition **logic** lives in
component 4 — this slice only stores the result. Resets on `clearTour`.

### `breadcrumb-progress-slice.ts` — visited breadcrumbs (viewing)

`{ visitedIndices: readonly number[] }`. `markBreadcrumbVisited(index)` is
idempotent. **Not persisted** (unlike `tourProgress`) — re-showing a couple
of already-passed breadcrumbs after a reload is cosmetic. Resets on
`clearTour`. Selection logic (which index is nearest) lives in
`ar-scene/core/breadcrumb-progress.ts` — this slice only stores the result,
same split as `zones-slice.ts`.

### `authoring-slice.ts` — the draft (authoring)

Mirrors `Tour` fields (draft has no top-level id — added at export). Actions:
`setTourMeta`, `addWaypoint`, `updateWaypoint`, `removeWaypoint`, `attachAsset`,
`removeAsset`, `addBreadcrumbPoint`, `clearAuthoring`. Holds `AssetEntry`
(id/type/filename) only — bytes flow through the injected `AssetProvider`.
Invariants held at author time: model/sprite mutual exclusivity (attaching one
clears the other); `removeAsset` clears any waypoint slot referencing it so the
draft never carries a dangling reference. `DEFAULT_PREFETCH_RADIUS_M` /
`DEFAULT_ACTIVE_RADIUS_M` (contract §4) seed new waypoints.

### `selectors.ts` — the read surface

Contract §2.3 set — `selectTour`, `selectOrderedWaypoints`,
`selectNextUnvisitedWaypoint`, `selectTourProgress`, `selectWaypointZone`,
`selectActiveWaypointIds`, `selectWaypointVisual(wp)`, `selectExportedTour` —
plus additive conveniences (`selectAssets`, `selectWaypointById`,
`selectIsWaypointVisited`, `selectVisitedWaypointIds`,
`selectVisitedBreadcrumbIndices`, `selectAuthoring*`).
`selectWaypointVisual` takes a `Waypoint`, not state. `selectExportedTour` bridges
the authoring draft → a canonical, `validateTour`-passing `Tour` (packaging's read
point). Typed against minimal structural state shapes, so they stay framework-free
while working on the live store.

### `viewing-store.ts` / `authoring-store.ts` — factories

`createViewingStore()` composes `tour`/`tourProgress`/`zones`/`breadcrumbProgress`;
`createAuthoringStore()` composes `authoring` and whitelists all `authoring/*`
actions into the recording/replay stream via `persistedExtraPrefixes` (one
slice-prefix, derived from an action type — never a literal). Both wrap the
framework's `createSlamAppStore` and default the storage backend to
`NullStorageBackend`. **`persistedExtraPrefixes` means recordable/replayable
(contract D12), not browser-reload durability** — there is no rehydration path.

### `fixtures/sample-tour.{ts,json}` — the canonical fixture

One tour, three waypoints (sprite+audio+transcript / transcript-only / empty),
two assets. Shared by `store.test.ts` and the demo; the `.json` mirrors the `.ts`.
Passes `validateTour` by construction (asserted in tests).

## Examples

```ts
import { createViewingStore } from "./viewing-store.js";
import { validateTour } from "./validate-tour.js";
import { loadTour, clearTour } from "./tour-slice.js";
import { selectNextUnvisitedWaypoint } from "./selectors.js";

const store = createViewingStore();
const tour = validateTour(await (await fetch("tour.json")).json());
store.dispatch(loadTour(tour));
const next = selectNextUnvisitedWaypoint(store.getState()); // Waypoint | null
```

## Tests

`store.test.ts` (run by `pnpm test:unit`): `validateTour` (valid fixture +
one failing case per invariant 1/2/4/5 + shape), each slice (initial state, each
action, idempotency, cross-slice `clearTour` resets), each selector against a
fixture state (`selectNextUnvisitedWaypoint` before/after visits,
`selectWaypointVisual` model/sprite/empty, `selectExportedTour` round-trips to a
valid `Tour`), and factory smoke tests (both construct and expose their slices).
`parse-tour-json.test.ts` covers the text gate (valid round-trip, malformed
JSON, invariant violation — all surfacing as `TourValidationError`). The
interactive `src/components/store/` demo exercises the view layer manually.
