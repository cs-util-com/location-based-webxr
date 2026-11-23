# ar-space-correction-slice.ts

## Purpose

The `arSpaceCorrection` slice: the raw relocalization observations of an AR session, and the memoised selectors that derive the correction of every older observation epoch (the loop-closure layer's output). The composition with the GPS alignment lives apart, in `ar-space-world.ts`, so nothing that imports this slice reaches the alignment.

## Public API

- `relocalizationObserved(payload: RelocalizationObservation)`: action `arSpaceCorrection/relocalizationObserved`. The payload is `RelocalizationJump` of `ar/ar-space-correction.ts`: `{ t, tLast, lastPose, tPrev, prevPose, newPose }`, all raw. The action creator keeps only these six fields (a `prepare` callback), so an object that carries more, such as a feed's own record, never records more; a non-object passes through for the reducer to refuse.
- `arSpaceCorrectionReducer`, a built-in of `createSlamAppStore` under the key `arSpaceCorrection`.
- `ArSpaceCorrectionState`: `{ observations }`; `RootWithArSpaceCorrection`: the structural root the selectors take.
- `UNIT_QUATERNION_TOLERANCE = 1e-3`.
- Selectors:
  - `selectArSpaceObservations(state)`: the raw observations, oldest first.
  - `selectArSpaceCorrectionEpoch(state)`: the current epoch (the observation count).
  - `selectArSpaceEpochAt(state, capturedAt)`: the epoch of an item captured at `capturedAt` (epoch-ms XR clock); `TypeError` for NaN.
  - `selectCorrectionTrack(state)`: `Delta(0..n)` in O, reference-stable while the observations are unchanged; reads no GPS state.

## Invariants & assumptions

- **Raw only.** The state holds what the feed saw; `D`, `Delta` and every composed pose are derived. A recording therefore replays the correction from its raw actions, and a better jump rule changes an old recording's result without touching its file.
- **Validation in the reducer, never a throw.** Refused, with the state unchanged and one `ArSpaceCorrection` warning naming the reason: a missing payload; non-finite `t` or `tLast`; `tLast >= t`; `t` before the previous observation's `t`; `tPrev` and `prevPose` not both present or both `null`; `tPrev >= tLast`; a position that is not 3 finite numbers; a rotation that is not 4 finite numbers within `UNIT_QUATERNION_TOLERANCE` of unit length. A replay refuses the same action the same way.
- **`UNIT_QUATERNION_TOLERANCE = 1e-3`:** WebXR delivers float32 unit quaternions (about 1e-7 off unit) and a JSON round trip keeps that; 1e-3 accepts both with a wide margin and still refuses a zero, scaled or garbled quaternion. Any value from 1e-6 to 1e-2 gives the same verdict on such input.
- **Segmenting:** the action type is in `SEGMENTING_ACTION_TYPES`, so the QR sighting fold segments at it and the Tour Viewer's capture geo join declines a recording holding it.
- **Recorded:** `createSlamAppStore` whitelists the `arSpaceCorrection` prefix for persistence.
- **Layering:** `raw actions -> correction track -> GPS alignment -> world`. `selectCorrectionTrack` never reads `gpsData`; an observation leaves the alignment untouched. The import closure of this module never reaches the alignment (structure test).
- **Not cleared by `teardownArSessionState`, and that is harmless for an app that keeps one store across AR sessions.** Each recording has its own store, whose observations start empty. An app that keeps its store into a second AR session keeps the first session's observations; they only change the correction of epochs before them. A new session's content is tracked at the current epoch (the observation count), and the XR clock that times every new observation and `capturedAt` hint only grows, so no new item falls into an old epoch and no old jump is applied to new content.

## Examples

```ts
store.dispatch(
  relocalizationObserved({ t, tLast, lastPose, tPrev, prevPose, newPose })
);
const epoch = selectArSpaceEpochAt(store.getState(), tile.capturedAt);
const track = selectCorrectionTrack(store.getState()); // Delta(0..n)
```

## Tests

- `ar-space-correction-slice.test.ts`: storage, the explicit absence of an earlier frame, boundary validation (one logged warning per refusal), the time order, `epochAt` through the store, the layers kept apart (GPS fixes leave the track reference-equal; an observation leaves `gpsData` deeply equal), the six-field action creator, segmenting, persistence.
- `ar-space-correction-slice.property.test.ts`: random streams of valid and broken observations leave exactly the valid ones, in time order, with only the six fields.
