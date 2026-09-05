# recording-migration.ts

## Purpose

Migrates old JS recording actions across five recording eras so the reducer always receives actions in the current format (era 5: raw WebXR positions + raw WebXR quaternions + `rawGpsPoint` + `rawDeviceOrientation`).

## Public API

### `ODOM_COORD_VERSION = 5`

Version constant written to `session.json` (`odomCoordVersion: 5`) when stopping a new recording. Replay loading uses this to determine migration era.

### `migrateActionsIfNeeded(actions, metadata)`

- **Input:**
  - `actions: RecordedAction[]` — Redux actions loaded from the zip file
  - `metadata: Record<string, unknown> | null` — Parsed `session.json`, or `null` if absent
- **Output:** `RecordedAction[]` — migrated actions (new array if migration applied, same reference if not)
- **Error:** Never throws. Actions with malformed or missing payload fields are returned unmodified.

## Five Recording Eras

| Era | Period                    | `odomCoordVersion` | Positions in actions | Rotations in actions | GPS in actions | Migration needed                                                                     |
| --- | ------------------------- | ------------------ | -------------------- | -------------------- | -------------- | ------------------------------------------------------------------------------------ |
| 1   | Pre-2026-03-15            | absent             | Raw WebXR            | Raw WebXR            | `gpsPoint`     | Rename `gpsPoint` → `rawGpsPoint`, strip derived fields, swap GPS coords ENU→NUE     |
| 2   | 2026-03-15 → Conv1 change | `2`                | NUE (pre-converted)  | Raw WebXR            | `gpsPoint`     | Reverse positions NUE→WebXR, rename `gpsPoint` → `rawGpsPoint`, strip derived fields |
| 3   | Conv1 → Conv2+3 change    | `3`                | Raw WebXR            | Raw WebXR            | `gpsPoint`     | Rename `gpsPoint` → `rawGpsPoint`, strip derived fields                              |
| 4   | Pre-rotation-unification  | `4`                | Raw WebXR            | Raw WebXR            | `rawGpsPoint`  | No migration (pass-through)                                                          |
| 5   | Current                   | `5`                | Raw WebXR            | Raw WebXR            | `rawGpsPoint`  | No migration (same action format as era 4; reducer converts rotations to NUE)        |

## Invariants & Assumptions

- **Idempotent for eras 4+5**: If `metadata.odomCoordVersion >= 4`, the era pass returns the original array unchanged (same reference). Eras 4 and 5 have identical action formats — the difference is state-side only (era 5 reducer applies `webxrQuaternionToNUE()` to all quaternion fields).
- **Step 5.6 — `refPoints` injection pass** (always runs, independent of era): synthesises a `refPoints/addRefPointEntry` action immediately after each `gpsData/markReferencePoint`, copying `id`, `timestamp`, and the (post-era-migration) `rawGpsPoint` verbatim. This is what populates the flat `refPoints` slice for replayed legacy zips — the slice's persistence middleware only records `gpsData/*` / `recording/*` actions, so no zip in the corpus carries `refPoints/*` actions yet. **Idempotent**: when the stream already contains any `refPoints/*` action (future post-Step-5.7 era), the injection pass is skipped and the original array reference is returned. **Same-reference contract**: when no `markReferencePoint` exists in the stream, the original array reference is also returned. The translator does not invent a `name` field — sidecar names come from the OPFS reader's `setImportedRefPointEntries` dispatch (Step 5.5); `selectKnownAnchorsByCell` merges the two streams by H3 cell and picks the first non-null name per cell. Plan: [§B.5 5.6 of 2026-05-27 slice-collapse plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md).
- **Step 8 — validation is the loader's job, not the listener's**: the injection pass is the single normalization point for `markReferencePoint` payloads (the old per-action listener middlewares that silently `return`ed on bad payloads were deleted in Step 5.7). A mark is dropped (and a `warn` is logged — not silently swallowed) when it lacks a string `id`, lacks a `rawGpsPoint` object, or its `rawGpsPoint.latitude`/`longitude` are not finite numbers. Validating coordinates here stops `undefined`/`NaN` GPS from reaching the H3 matcher and `selectKnownAnchorsByCell`. Validation is a per-mark _filter_: one bad mark never suppresses the valid marks around it. Review: [§G.8 of 2026-05-27 listener-middleware & OPFS-state review](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-listener-middleware-and-opfs-state-review.md).
- **Non-mutating**: Migrated recordings return new array with new payload objects. Original array is never mutated.
- **Null metadata = era 1**: If `session.json` is absent, the recording is treated as era 1.
- **`migrateGpsPointField()`** (internal): Renames `gpsPoint` to `rawGpsPoint` and strips derived fields (`coordinates`, `weight`, `zeroRef`, `deviceRotation`). Applied to eras 1, 2, and 3.
- **Era 2 reverse-migration**: Undoes NUE positions back to WebXR via `[n,u,e] → [e, u, -n]` so the reducer can apply the standard forward conversion.
- Action types migrated: `gpsData/recordGpsEvent`, `gpsData/markReferencePoint`, `gpsData/add2dImage`, `gpsData/odometryTrackingRestarted`.
- **Deliberately NOT migrated — the two solver actions renamed on 2026-09-05** (owner decision DEC-C9 of the consensus-solver rename plan, private docs tree: `GpsPlusSlamJs/docs/2026-09-05-0914-consensus-solver-rename-plan.md`). Recordings made before `gps-plus-slam-js` 1.24.0 with the debug wheel's comparison arm or heading-penalty slider carry `gpsData/setRobustSolverComparisonEnabled` and `gpsData/setRobustSolverHeadingPenalty`; the reducers now answer to `gpsData/setConsensusSolverComparisonEnabled` and `gpsData/setConsensusSolverHeadingPenalty`, so Redux drops the old types silently and such a recording replays with the DEFAULT solver configuration. An Investigation sweep over one of those zips is therefore not a reproduction of what the device computed. The embedded `RecordingOptions.compassDebug.robustSolverComparison` flag IS still read (as an alias of `consensusSolverComparison`, see `state/recording-options.ts`), which is how such a zip can be recognised.

## Tests

- `src/storage/recording-migration.test.ts` — unit tests covering all five eras, GPS field migration, position reversal, malformed payload guards, immutability, empty arrays, null metadata handling, the Step 5.6 `refPoints` injection pass (insertion shape, idempotency on streams already carrying V2 actions, same-reference contract when no `markReferencePoint`, and interaction with era-1 `gpsPoint→rawGpsPoint` rename), and the Step 8 loader-boundary validation (drops + warns on marks missing finite `rawGpsPoint` coordinates while keeping the valid marks in the same stream).

## Related Docs

- [Raw-storage pattern audit](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-10-raw-storage-pattern-audit.md) — Verification that actions carry raw values and reducers convert
- [Store Raw, Convert on Read analysis](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-09-raw-storage-convert-on-read.md) — Feasibility study for the raw-storage pattern
- [Raw data fidelity audit](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-08-raw-data-fidelity-audit.md) — Comprehensive audit of all persisted action payloads
