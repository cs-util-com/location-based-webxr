# recording-slice.ts

## Purpose

Redux Toolkit slice for recorder session management. Extracted from inline code in `store.ts` (§4 — `configureStore` migration) to break circular dependencies with `persistence-middleware.ts` and follow the same pattern as `ref-points-slice.ts` and `routing-slice.ts`.

## Public API

| Export               | Kind           | Description                                                                                           |
| -------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `RecordingState`     | Type           | Shape of the `recorder` state slice                                                                   |
| `SessionMetadata`    | Type           | Session metadata: scenario name, session name, start time, etc.                                       |
| `recordingReducer`   | Reducer        | RTK slice reducer for `recording/*` actions                                                           |
| `startSession`       | Action creator | `recording/startSession` — sets `isRecording = true`, stores metadata, resets counters                |
| `endSession`         | Action creator | `recording/endSession` — sets `isRecording = false`                                                   |
| `recordDepthSample`  | Action creator | `recording/recordDepthSample` — stores the latest sample in `latestDepthSample`; persisted for replay |
| `recordWriteFailure` | Action creator | `recording/recordWriteFailure` — increments `failedWriteCount`                                        |

## Invariants & Assumptions

- `startSession` resets `actionCount`, `failedWriteCount` and `latestDepthSample` — each session starts clean.
- `recordDepthSample` stores only the **latest** sample (`latestDepthSample`) so subscribers can observe new samples via reference comparison (occupancy-grid wiring, see the 2026-06-11 port plan); the action payload is persisted by `persistence-middleware.ts` for replay and stays **raw WebXR / conversion-free**. No sample history is kept in state.
- `recordWriteFailure` is the only action tracking persistence errors. It is **excluded** from persistence by the middleware to prevent recursion.
- This slice is scenario-agnostic. The currently-selected scenario name lives in the recorder app's [`scenario-slice`](../../../GpsPlusSlamJs_RecorderApp/src/state/scenario-slice.ts.md) and is read by the recorder when stamping `SessionMetadata` (Iter 1D of the [boundary migration](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md))..

## Examples

```typescript
import {
  recordingReducer,
  startSession,
  endSession,
  recordWriteFailure,
} from './recording-slice';

// In configureStore:
const store = configureStore({
  reducer: { recorder: recordingReducer /* ... */ },
});

// Start a session
store.dispatch(
  startSession({
    scenarioName: 'Park',
    sessionName: 'run-1',
    startTime: Date.now(),
  })
);

// Track a write failure
store.dispatch(recordWriteFailure('OPFS write failed'));
console.log(store.getState().recorder.failedWriteCount); // 1
```

## Tests

- `recording-slice.test.ts` — `latestDepthSample` behavior (initial null, stores by reference, replaced per dispatch, cleared by `startSession`, action type stays `recording/recordDepthSample`).
- `store.test.ts` — covers all recorder actions as part of the integrated store (state transitions, startSession/endSession, failedWriteCount tracking).
- `persistence-middleware.test.ts` — 13 tests verify that `recordWriteFailure` is excluded from persistence and dispatched on errors.

## Related

- [create-slam-app-store.ts](create-slam-app-store.ts.md) — the factory that combines this slice with the others
- [persistence-middleware.ts](persistence-middleware.ts.md) — middleware consuming `recordWriteFailure`
- [ref-points-slice.ts](../../../GpsPlusSlamJs_RecorderApp/src/state/ref-points-slice.ts.md) — same pattern, but it lives in the RECORDER (not a framework sibling)
- [routing-slice.ts](../../../GpsPlusSlamJs_RecorderApp/src/state/routing-slice.ts.md) — same pattern, but it lives in the RECORDER (not a framework sibling)
