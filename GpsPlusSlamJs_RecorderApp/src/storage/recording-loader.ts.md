# recording-loader.ts

## Purpose

Version-transparent entry point for reading recording zips. Hides recording-format evolution (era-1 through era-5) from every consumer (replay engine, audits, regression tests, investigation harness) by returning a fully-normalized [`LoadedRecording`](recording-loader.ts).

Background and motivation: [`2026-05-19-recording-loader-abstraction-plan.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-recording-loader-abstraction-plan.md).

## Public API

- `loadRecording(zip: ZipSource): Promise<LoadedRecording>`
  - `ZipSource = Uint8Array | Reader<unknown>` (framework `storage/zip-reader`): pass the full zip bytes, or any zip.js `Reader` (e.g. an fd-backed ranged reader) so large archives are read lazily — central directory + JSON entries only, never image payloads. Added 2026-07-09 for the Investigation corpus gate's 60 s budget fix.
  - Reader contract: one instance backs the three concurrent helpers below (Promise.all), so `init()` must be idempotent and ranged reads must interleave safely. Caller owns the resource lifecycle and may release it once the promise settles (`getFinalState()` never re-reads the zip). Runtime Reader support requires a framework build exporting `toZipReader` — external consumers resolving the framework from npm must probe for it.
  - Reads metadata, actions, and ref-point sidecars from `zip` in parallel.
  - Applies [`migrateActionsIfNeeded`](recording-migration.ts) to actions so callers always see the current schema.
  - Builds a unified `RefPointDefinition[]` from sidecar `refPoints/*.json` files **merged** with `gpsData/markReferencePoint` actions in the log. Sidecar wins per id; ids that appear only in actions get reconstructed defs.
- `LoadedRecording` (immutable):
  - `meta: Record<string, unknown> | null` — `session.json`, or `null` when absent.
  - `actions: readonly ZipActionEntry[]` — chronological, post-migration.
  - `refPoints: readonly RefPointDefinition[]` — sidecar ∪ action-derived.
  - `capabilities: { hasSidecarRefPoints, hasFusedObservations, hasSessionMeta, migrationApplied }`.
  - `getFinalState(): CombinedRootState` — lazy, memoized replay into a fresh recorder store (`NullStorageBackend`, dev checks disabled).
- `RecordingCapabilities`, `LoadedRecording` — re-exported types.
- `isMarkRefPointAction(a: RecordedAction): a is RecordedAction & { payload: MarkRefPointPayload }`
  - Type guard for a well-formed `gpsData/markReferencePoint` action. Validates `payload.id` (string), `payload.timestamp` (number), and the pose arrays **by length**: `position` must have ≥ 3 elements (`Vector3`) and `rotation` ≥ 4 (`Quaternion`). Exported for direct unit testing of this boundary contract.

## Invariants & Assumptions

- The migration layer is the single source of schema canonicalization. Action-derived ref-point reconstruction reads `payload.rawGpsPoint` (post-migration name) and only falls back to `payload.gpsPoint` defensively.
- Pose-array length is validated at the `isMarkRefPointAction` boundary, not just array-ness. The migration layer validates GPS coordinates but never `position`/`rotation`, so this guard is the only thing stopping a short array from injecting `undefined` into the typed number tuples that `buildDefsFromActions` writes (`position[2]`, `rotation[3]`).
- Merge rule: action-derived defs are loaded first, then sidecar defs overwrite by id. This guarantees sidecar wins whenever both exist for the same `id`.
- `sessionId` for synthesized observations is taken from the `recording/startSession` action's `payload.sessionName`. Falls back to `${meta.contextTag}-${meta.startedAt}`, then `'legacy-session'`. Stable per-recording but not globally unique for legacy recordings without a startSession action — acceptable because consumers (visualizer, audit) only use `sessionId` for grouping.
- `getFinalState()` constructs a brand-new store on first call and caches the result. Suitable for tests and one-off audits; not suitable for long-running replay UIs (use the dedicated replay engine for those).
- Sidecar validation uses the deep [`isRefPointDefinition`](ref-point-loader.ts) — the same guard the OPFS loader uses. It validates the base shape (id/name/createdAt/observations[]) **and** every observation's nested `arPose.position`/`arPose.rotation` arrays and `gpsPoint.latitude`/`gpsPoint.longitude` numbers. A sidecar whose top-level shape is valid but whose observations are malformed is skipped, so consumers such as `flattenRefPointsToMarks` never read those nested fields off undefined. (The shape-only `isRefPointDefinitionShape` is intentionally _not_ used here — it would let malformed observations through.)
- Parse errors in individual sidecar files are logged and skipped, never thrown. The loader is best-effort: a corrupted sidecar must not block loading the rest of the recording.

## Examples

```ts
import { loadRecording } from './recording-loader';
import * as fs from 'node:fs';

const zip = new Uint8Array(fs.readFileSync('recording.zip'));
const rec = await loadRecording(zip);

console.log(
  `Recording has ${rec.actions.length} actions, ${rec.refPoints.length} ref points`
);
if (!rec.capabilities.hasSidecarRefPoints) {
  console.log('Legacy recording — ref points reconstructed from actions');
}
if (rec.capabilities.migrationApplied) {
  console.log('Pre-era-4 recording — schema rewritten on the fly');
}

// Lazy: only replays when you ask.
const state = rec.getFinalState();
```

## Tests

- [`recording-loader.test.ts`](recording-loader.test.ts) — end-to-end against real fixtures from `TestDataJs/`:
  - `2026-03-05_06-47-31utc.zip` (era ≤ 3): asserts `migrationApplied`, no sidecars, refPoints reconstructed from actions with finite lat/lon.
  - `2026-04-23_15-55-36utc.zip` (era ≥ 4): asserts sidecar present, session.json present, at least one curated name (`name !== id`).
  - `getFinalState()` is memoized (`first === second`).
  - `isMarkRefPointAction — pose-array length contract`: fixture-free unit tests that accept full-length poses (3/4) and reject short or empty `position`/`rotation` arrays, proving the guard blocks `undefined`-injecting payloads.
  - `loadRecording — a Tour Viewer authoring recording` (fixture-free, 2026-09-28): a zip in the Tour Viewer's troubleshooting-recording layout (the shared framework `session.json` builder with `contextTag: "tour-authoring"`, two AR entries each closed by `endSession` + `resetGpsSessionData`, an unknown `tourAuthoring/finished` between them) loads as era 5 with no migration, keeps every action in order and replays; without `session.json` the same zip is taken for era 1. The Tour Viewer's own tests pin that it writes this layout ([authoring recording plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md) D6).
  - `loadRecording — lazy ZipSource Reader input`: fd-backed ranged Reader yields a `LoadedRecording` deep-equal to the Uint8Array path for both the modern and the legacy (migration) fixture — the pre-publish guard for the lazy chain, running against framework source via the vitest alias.

Tests skip themselves when `TestDataJs/` is not on disk (CI without test corpus).
