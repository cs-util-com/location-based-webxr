# recorder-store.ts

## Purpose

Recorder-app composable Redux store. Wraps the framework's
[`createSlamAppStore`](../../../GpsPlusSlamJs_AppFramework/src/state/create-slam-app-store.ts.md)
and supplies the recorder-only slices via `extraReducers`:

- `refPoints` — local [ref-points-slice.ts](ref-points-slice.ts.md).
- `routing` — local [routing-slice.ts](routing-slice.ts.md).
- `scenario` — local [scenario-slice.ts](scenario-slice.ts.md).
- `qrDetected` — framework-owned QR slice, mounted here with a longer
  live-history cap (`RECORDER_QR_MAX_HISTORY`).

Historical note: during Iter 1–3 of the
[boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md)
this module also re-exported the framework/state surface so consumers only
needed a path swap. That re-export layer has been removed — consumers now
import each symbol from its true source (recording actions from
`gps-plus-slam-app-framework/state/recording-slice`, GPS/QR actions and raw
sensor types from `gps-plus-slam-app-framework/state`, scenario actions from
[scenario-slice.ts](scenario-slice.ts.md), etc.).

All core-library symbols are consumed through `gps-plus-slam-app-framework`
(no direct `gps-plus-slam-js` import). Raw sensor types
(`RawDeviceOrientation` & friends) must be imported from the `/state`
subpath rather than the framework root barrel because the root barrel
exposes a _different_, nullable variant from `sensors/gps.ts`. See
[`2026-05-05-recorder-app-drop-direct-core-dep-plan.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-05-recorder-app-drop-direct-core-dep-plan.md)
§2.2.1 for the type-identity rationale.

## Public API

- `createRecorderStore(options?)` — produces a `RecorderStore`.
- `RecorderStore` — `{ getState, dispatch, subscribe, writeFrame, writeSessionMetadata }`.
- `RecorderStoreOptions` — `{ onWriteFailure?, storageBackend?, enableDevChecks?, licenseKey?, enableCompassColdStartOverride?, enableCompassRotationPrior?, enableCompassWebXRConsistency? }`.
- `CombinedRootState` — `LibraryRootState` + `recording`, `tracking`,
  `trackingQuality`, `arSpaceCorrection`, `refPoints`, `routing`, `scenario`, `qrDetected`.
- `RECORDER_QR_MAX_HISTORY` — live QR history cap the recorder opts into.
- `RootState`, `AppDispatch` — convenience type aliases.

## Invariants

- `storageBackend` defaults to `ScenarioWrappingStorageBackend` (OPFS
  wrapped with scenario routing). Tests / replay must pass
  `NullStorageBackend`.
- `licenseKey` defaults to the bundled community key via the framework
  factory; validation always runs and throws on invalid keys.
- `refPoints`/`routing`/`scenario`/`qrDetected` are mounted as
  `extraReducers` — the framework factory has no concept of them.
- `refPoints/*` and `qrDetected/*` actions are whitelisted for
  persistence via `persistedExtraPrefixes`, derived from the slices' own
  action types (never string literals).

## Examples

```ts
import { createRecorderStore } from './recorder-store';

const store = createRecorderStore({
  onWriteFailure: (err) => showToast(err.message),
});
store.dispatch(navigateTo('ar'));
```

## Tests

- [recorder-store.test.ts](recorder-store.test.ts) — combined-store
  integration coverage (slices wired, persistence routing, license
  validation). Migrated from the framework's now-removed `store.test.ts`.
- [recorder-store-types.test.ts](recorder-store-types.test.ts) —
  type-identity regression tests asserting the library types the recorder
  imports from `gps-plus-slam-app-framework/state`
  (`RawDeviceOrientation`, `RawGpsPoint`, `RecordGpsEventPayload`)
  keep their library shape after routing
  through the framework. Locks in §2.2.1 of the
  [drop-direct-core-dep plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-05-recorder-app-drop-direct-core-dep-plan.md).

## Related

- [ref-points-slice.ts](ref-points-slice.ts.md) — local ref-points slice.
- [routing-slice.ts](routing-slice.ts.md) — local routing slice.
- [scenario-slice.ts](scenario-slice.ts.md) — local scenario slice.
- [Iter 1 plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
