# viewing-log.ts

## Purpose

The visitor's `tourViewing/*` log: thin hooks the viewer pipeline
(`viewer-placement.ts`) calls at its existing seams - a recorded detection,
each vote it dispatches, the voted lock, a placement - turned into the log
actions of `tour-viewing-actions.ts` for the `?debug=1` viewer recording.
Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1b.

## Public API

- `createViewingLog({ enabled, dispatch, alignmentMatrix, scanGate, arVisitIndex, now }): ViewingLog`
  - `enabled()` - the recording's persistence gate (`recording.persistWhile`).
  - `dispatch(action)` - into the page's store.
  - `alignmentMatrix()`, `scanGate()`, `arVisitIndex()`, `now()` - read at
    each log.
- `ViewingLog.detection(event, level, statusBefore)` - a locked frame's
  detection; logs `codeLocked` when it starts tracking.
- `ViewingLog.vote(payload)` - one dispatched vote (collected).
- `ViewingLog.votedLock(text, votedLocks)` - logs the collected votes as one
  `votesCast`.
- `ViewingLog.placed(input)` - logs `tourPlaced`, adding the alignment, the
  visit and the time.

## Invariants & assumptions

- **Silent while off.** Every hook returns at once unless `enabled()`: no
  action is dispatched and no vote is kept (a vote seen while off is not
  carried into a later batch). A visitor without `?debug=1` and the switch
  pays nothing, not even a store subscriber's render per lock.
- **A lock is logged when it starts tracking**, not per locked frame: the
  controller locks at the camera cadence and every locked frame is already a
  `qrDetected/*` action. A lock is new when the status before it was not
  `tracking` (the code was lost in between), when it is another code, or in
  another AR visit. `statusBefore` is `ctx.viewerQrStatus` at the detection,
  which the framework's controller updates only AFTER the frame's votes.
- **Votes are logged per lock.** The controller dispatches a lock's votes one
  by one, then reports the voted lock (`qr-viewer-mode.ts`,
  `dispatchVotes`); the hook collects them in between. A vote path that
  bypasses `dispatchVote` (a keep-alive that re-casts votes outside a lock,
  if one is added) is still in the raw stream as `gpsData/recordGpsEvent`,
  but not in a `votesCast` batch unless it calls these hooks too.
- **Dispatched at top level**: from the controller's detection callbacks and
  from the placements' async continuations, never inside another dispatch.

## Examples

```ts
const viewingLog = createViewingLog({
  enabled: () => recording.persistWhile(),
  dispatch: (action) => arStore.dispatch(action),
  alignmentMatrix: () => selectAlignmentMatrix(arStore.getState()),
  scanGate: () => ctx.scanGate.kind,
  arVisitIndex: () => ctx.arSessionGeneration,
  now: () => Date.now(),
});
createViewerPlacement({ ...deps, viewingLog });
```

## Tests

`viewing-log.test.ts`: nothing logged or kept while off; a lock's payload; a
lock per acquisition, not per frame (a miss, another code, another visit);
votes as one batch per lock; a placement's payload; every payload survives
JSON. `viewer-placement-viewing-log.test.ts`: the hooks through the real
viewer controller config, and exactly today's dispatches without a running
recording. End to end: `playwright-tests/ar-mode.spec.js` ("a visitor records
only with ?debug=1 ...").
