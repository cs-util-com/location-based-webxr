# ar-space-correction-slice.ts

## Purpose

The `arSpaceCorrection` slice: the raw relocalization observations of an AR session, and the memoised selectors that derive the correction of every older observation epoch (the loop-closure layer's output) and its composition with the GPS alignment.

## Public API

- `relocalizationObserved(payload: RelocalizationObservation)`: action `arSpaceCorrection/relocalizationObserved`. The payload is `RelocalizationJump` of `ar/ar-space-correction.ts`: `{ t, tLast, lastPose, tPrev, prevPose, newPose }`, all raw.
- `arSpaceCorrectionReducer`, a built-in of `createSlamAppStore` under the key `arSpaceCorrection`.
- `ArSpaceCorrectionState`: `{ observations }`; `RootWithArSpaceCorrection`: the structural root the selectors take.
- `UNIT_QUATERNION_TOLERANCE = 1e-3`.
- Selectors:
  - `selectArSpaceObservations(state)`: the raw observations, oldest first.
  - `selectArSpaceCorrectionEpoch(state)`: the current epoch (the observation count).
  - `selectArSpaceEpochAt(state, capturedAt)`: the epoch of an item captured at `capturedAt` (epoch-ms XR clock); `TypeError` for NaN.
  - `selectCorrectionTrack(state)`: `Delta(0..n)` in O, reference-stable while the observations are unchanged; reads no GPS state.
  - `selectArSpaceToWorld(state, epoch)`: `A * Delta(epoch)`, column-major; `null` before an alignment exists; `RangeError` for an epoch that is not an integer in `0..n`. Memoised on the track and the alignment.
  - `arSpaceWorldPose(state, xRaw, epoch, parentToGroup = I)`: `A * Delta(epoch) * P * X_raw`.

## Invariants & assumptions

- **Raw only.** The state holds what the feed saw; `D`, `Delta` and every composed pose are derived. A recording therefore replays the correction from its raw actions, and a better jump rule changes an old recording's result without touching its file.
- **Validation in the reducer, never a throw.** Refused, with the state unchanged and one `ArSpaceCorrection` warning naming the reason: a missing payload; non-finite `t` or `tLast`; `tLast >= t`; `t` before the previous observation's `t`; `tPrev` and `prevPose` not both present or both `null`; `tPrev >= tLast`; a position that is not 3 finite numbers; a rotation that is not 4 finite numbers within `UNIT_QUATERNION_TOLERANCE` of unit length. A replay refuses the same action the same way.
- **`UNIT_QUATERNION_TOLERANCE = 1e-3`:** WebXR delivers float32 unit quaternions (about 1e-7 off unit) and a JSON round trip keeps that; 1e-3 accepts both with a wide margin and still refuses a zero, scaled or garbled quaternion. Any value from 1e-6 to 1e-2 gives the same verdict on such input.
- **Segmenting:** the action type is in `SEGMENTING_ACTION_TYPES`, so the QR sighting fold segments at it and the Tour Viewer's capture geo join declines a recording holding it.
- **Recorded:** `createSlamAppStore` whitelists the `arSpaceCorrection` prefix for persistence.
- **Layering:** `raw actions -> correction track -> GPS alignment -> world`. `selectCorrectionTrack` never reads `gpsData`; an observation leaves the alignment untouched. Until the alignment fits the corrected odometry, no world or map consumer may read `selectArSpaceToWorld` or `arSpaceWorldPose` (they would pair a corrected `Delta` with an alignment fitted across two frames).
- **Not cleared by `teardownArSessionState`:** each recording has its own store, whose observations start empty.

## Examples

```ts
store.dispatch(
  relocalizationObserved({ t, tLast, lastPose, tPrev, prevPose, newPose })
);
const epoch = selectArSpaceEpochAt(store.getState(), tile.capturedAt);
const track = selectCorrectionTrack(store.getState()); // Delta(0..n)
```

## Tests

- `ar-space-correction-slice.test.ts`: storage, the explicit absence of an earlier frame, U8 validation (one logged warning per refusal), the time order, U10 through the store, U6 (GPS fixes leave the track reference-equal; an observation leaves `gpsData` deeply equal; the composed selector equals `A * Delta`), null and `RangeError` cases, U3 against the wrong orders, segmenting, persistence.
- `ar-space-correction-slice.property.test.ts`: U3 over random non-commuting `A`, jumps and `P`.
