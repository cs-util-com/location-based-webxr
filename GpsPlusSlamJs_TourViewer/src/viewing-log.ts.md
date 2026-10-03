# viewing-log.ts

## Purpose

The visitor's `tourViewing/*` log: thin hooks the viewer pipeline
(`viewer-placement.ts`) calls at its existing seams - a recorded detection,
each vote it dispatches, the voted lock, a placement, the code keep-alive's
state changes - turned into the log actions of `tour-viewing-actions.ts` for
the `?debug=1` viewer recording.
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
- `ViewingLog.codeIgnored({ text, levelId, evidence, recovery })` - logs
  `codeIgnored` once per veto (D20, M5c; §7j #15), adding the alignment
  AFTER the recovery and the moment; silent while the recording is off.
- `ViewingLog.keepAlive(inner): QrVoteKeepAlive` - wraps the AR entry's
  keep-alive (`viewer-placement.ts`, `startKeepAlive`): every call is
  forwarded unchanged, and each state change is logged as
  `tourViewing/keepAlive` (M1b review #5).

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
- **Votes are logged per lock.** The pipeline hands a lock's votes over at
  once (`qr-viewer-mode.ts`, `dispatchVotes`; stored as one
  `recordGpsEventBatch` since M2e), calling `vote` for each, then reports
  the voted lock; the hook collects them in between. The code keep-alive's
  votes bypass it on purpose: they are in the raw stream as the events of a
  `gpsData/recordGpsEventBatch` with `qr-keep` ids (with the device fix
  they answer, first), never in a `votesCast` batch (a batch answers "which
  lock cast these").
- **The keep-alive is logged per state change, not per frame or fix.**
  The wrapper observes the keep-alive only through its public calls and
  `phase()`, so it does not depend on how the hold is kept:
  - `keep` (a voted lock) -> `armed`, with the code and the stable pose it
    re-votes from;
  - `relock` -> `relocked` only on the first frame of a NEW lock of the kept
    code (the lock start `detection` saw) or when it changed the phase's
    kind; the tracked frames after it restart the hold silently, and
    `phase` in each later entry carries the time base. A relock whose kept
    pose is older than one hold window restarts nothing
    (`holdsFreshPose`) and logs nothing; the re-scan's fresh voted lock is
    then an `armed`;
  - `votesForFix` -> `fading` / `ended` the first time a device fix finds
    the phase there (so a transition is logged at fix granularity), or
    `stopped` when the keep-alive dropped an unbuildable code;
  - `stop` -> `stopped` when something was kept (the AR exit's
    `endQrPipeline`, the tour close in `archive-open.ts`).
    A method the keep-alive gains later is forwarded by the spread but not
    logged until it is wrapped here.
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
JSON; the keep-alive's state changes over a real keep-alive (armed with its
pose, a re-scan, the fade, the end, the stop, and nothing per tracked frame
or per fix), its votes kept out of the lock batches, nothing while off.
`viewer-placement-viewing-log.test.ts`: the hooks through the real viewer
controller config, exactly today's dispatches without a running recording,
and the session's keep-alive as the logged one (armed, then the AR exit's
stop; silent without a recording). End to end: `playwright-tests/ar-mode.spec.js` ("a visitor records
only with ?debug=1 ...").
