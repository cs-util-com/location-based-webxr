# tracking-slice.ts

## Purpose

Redux Toolkit slice for the AR tracking-loss / tracking-restart state machine. Replaces the original `TrackingStateManager` class (formerly `ar/tracking-state.ts`, deleted in sub-step 4); see [2026-05-13-tracking-state-slice-port-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-tracking-state-slice-port-plan.md) for rationale and the full sub-step plan.

## Public API

- Types
  - `TrackingPhase` — `'initializing' | 'tracking' | 'lost'`. String-literal union (not a TS enum) so the value is structurally compatible with JSON / replay payloads.
  - `TrackingSliceState` — slice shape (`phase`, `lastValidPose`, `lastSensorOrientation`, `lostFrameCount`, `originResetDuringLoss`, `resetTransform`, `lastRestartedPayload`).
  - `DeviceOrientation` — a device-orientation snapshot with **per-axis nullable** angles.
    - ⚠️ **It was the "resolved, non-nullable counterpart" of `RawDeviceOrientation` until 2026-08-31, and that resolution was a silent bug.** It substituted `0` for an absent axis, and `0` is a legal reading meaning "facing north, flat and level" — so nothing downstream could tell a missing compass from a device pointing north.
    - The value is not diagnostic: it reaches the core library's `calcRotationOffsetFromRestart`, the rotation correction applied to the world after a tracking restart. Two fabricated readings cancel there, so a compass-less device was never harmed; the damage was the MIXED case, where availability changed between the last valid pose and the restart.
    - Angles are nullable **individually** because a phone with no magnetometer reports a null `alpha` beside real `beta`/`gamma`, and the library pairs the axes so tilt still corrects while heading cancels.
    - `absolute` stays a plain `boolean` — it describes the reading rather than being one.
  - `ResetTransformData` — serialized `XRReferenceSpaceEvent.transform` (position + orientation).
  - `PoseReceivedPayload` — `{ pose, sensorOrientation }`, where `sensorOrientation` is `DeviceOrientation | null` (`null` when the browser has reported nothing at all, as opposed to a reading with some axes missing).
- Actions
  - `poseReceived({ pose, sensorOrientation })` — atomic pose + orientation snapshot. INITIALIZING|LOST → TRACKING. On LOST → TRACKING with `originResetDuringLoss === true && lastValidPose !== null`, populates `lastRestartedPayload`.
  - `poseLost()` — increments `lostFrameCount`; TRACKING → LOST on first call.
  - `originReset(transform?)` — flags origin reset (only while LOST); accepts `ResetTransformData`, `null`, or omitted (= `undefined`). The three values are preserved literally.
  - `resetTracking()` — returns to initial state.
  - `clearLastRestartedPayload()` — host calls after consuming `lastRestartedPayload`.
- Reducer: `trackingReducer` (mounted as `tracking` in `createSlamAppStore`).
- Selectors: `selectTrackingPhase`, `selectLastValidPose`, `selectLostFrameCount`, `selectLastRestartedPayload`, `selectLastSensorOrientation`.

## Invariants & Assumptions

- `lostFrameCount` is non-negative (property test). Reset to 0 on every `poseReceived`.
- `originResetDuringLoss` is only `true` while `phase === 'lost'` (property test). The reducer clears it on the LOST → TRACKING transition together with `resetTransform`.
- `originReset` while not LOST is a no-op.
- `lastValidPose` is `null` until the first `poseReceived` (property test).
- `lastRestartedPayload` is **transient**: the host must call `clearLastRestartedPayload` between cycles. A subsequent **Case 1** (seamless) recovery does NOT clobber an unread payload; a consecutive **Case 2** (relocalization) recovery overwrites it. Both behaviours are pinned by tests.
- The `null lastValidPose` defensive branch on LOST → TRACKING-with-reset cannot be hit through the public API (because `lastValidPose` is set atomically alongside `lastSensorOrientation`), but is preserved as a defensive check and exercised via preloaded state.
- **A missing orientation is OMITTED from `lastRestartedPayload`, never zeroed or back-filled** (2026-08-31). Two rules, both asserted rather than left to the type, because each was previously violated in a way that looked harmless:
  - **No zero substitution.** Writing `{alpha: 0, …}` for an absent reading makes an incomplete pair look complete, and the library's `resolveSensorPair` would then trust it — reinstating the bug one layer down.
  - **No `?? sensorOrientation` back-fill.** The reducer used to substitute the NEW reading for a missing prior one. Its effect was accidentally benign (equal sides cancel in `newSensor · inv(lastSensor)`), but it recorded a claim that the earlier snapshot held a value it never had. A recording that misreports a sensor is worse than one admitting it said nothing.
  - The library decides what an incomplete pair means; this slice's only job is to let the incompleteness survive.
- The slice carries **no side effects** — the host (`ar/webxr-session.ts`) translates phase transitions into `onTrackingLost` / `onTrackingRestarted` / `onTrackingRecovered` callbacks via `store.subscribe`.

## Examples

```ts
import { configureStore } from '@reduxjs/toolkit';
import {
  trackingReducer,
  poseReceived,
  poseLost,
  originReset,
  selectLastRestartedPayload,
} from 'gps-plus-slam-app-framework';

const store = configureStore({ reducer: { tracking: trackingReducer } });

// New frame with a valid pose:
store.dispatch(
  poseReceived({
    pose: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    sensorOrientation: { alpha: 90, beta: 0, gamma: 0, absolute: true },
  })
);

// Tracking lost + relocalization:
store.dispatch(poseLost());
store.dispatch(originReset({ position: [0, 0, 0], orientation: [0, 0, 0, 1] }));
store.dispatch(
  poseReceived({
    pose: {
      position: { x: 1, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    sensorOrientation: { alpha: 90, beta: 0, gamma: 0, absolute: true },
  })
);

const payload = selectLastRestartedPayload(store.getState());
// → OdometryTrackingRestartedPayload with both poses, and both sensor
// orientations WHEN THE DEVICE SUPPLIED THEM. Either orientation field is
// absent if no reading existed at that moment; the library then re-bases on
// odometry alone rather than trusting half a pair.
```

## Tests

- [tracking-slice.test.ts](tracking-slice.test.ts) — unit tests covering the full state-machine matrix (initial state, every transition, Case 1 vs. Case 2 split, transient payload lifecycle, `resetTracking`).
- [tracking-slice.property.test.ts](tracking-slice.property.test.ts) — 6 property tests pinning the state-machine invariants under random `[poseReceived, poseLost, originReset, clearLastRestartedPayload]` walks.
- Coverage: 100% statements / branches / functions / lines on this file.

## Related

- [2026-05-13-tracking-state-slice-port-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-tracking-state-slice-port-plan.md) — port plan and sub-step roadmap.
- [2026-05-07-csharp-features-not-yet-ported.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md) — survey doc, P2 step 2.
- [create-slam-app-store.ts](create-slam-app-store.ts) — mounts `trackingReducer` under `state.tracking`.
- [recording-slice.ts](recording-slice.ts.md) — sibling slice following the same pattern.
