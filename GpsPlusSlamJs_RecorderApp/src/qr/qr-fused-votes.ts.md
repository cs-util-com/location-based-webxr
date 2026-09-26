# qr-fused-votes.ts

## Purpose

The RecorderApp's level-mode GPS votes on the FUSED QR pose (QR near-frontal
pose plan §71-§72, b6a): a code votes only once the joint rotation over its
recent detections is stable, and at that rotation, instead of at each lock's
single-frame solve - which near head-on is several degrees off in tilt, and
this alignment is what every other code in the session is minted against.

## Public API

- `createQrFusedVotes({ getQrState, isSpent, onEvaluated? })` →
  - `noteLevelSize(text, sizeM)` - a level resolved; remembers a finite,
    positive printed size (anything else is ignored).
  - `onRecorded(text)` - a raw detection of `text` was recorded; evaluates
    it (per detection, §66 #6).
  - `resolveStablePose(text)` - the lock's stable pose, or null (a cache
    hit after `onRecorded`).
  - `resetForStore()` - the store swapped; new trackers over the new store.
- `getQrState` reads the CURRENT store's `qrDetected` slice; `isSpent` is the
  vote budget's (`QrVoteBudget.isSpent`); `onEvaluated(result, text)` fires
  once per new evaluation.

## Invariants & assumptions

- **Fail closed on the size.** No size, no evaluation, no tracker: a tracker
  reads its size once when created, and the recorder's raw entries carry no
  single-frame pose, so the fused position (and the motion check) run at that
  size. At the 0.16 m default a 0.25 m code walked past reads as motion and a
  position ~0.4 m off (probed 2026-09-26, plan §72 #4).
- **Sizes live for the AR session, trackers per store.** The tracking
  controller fetches and caches a level once per session - often before
  Start Recording - so the size map is never cleared on a swap (§72 #1),
  while the trackers are rebuilt for each store so no hysteresis or motion
  state crosses into a store whose entries restart.
- **Per detection.** Evaluated in `onRawDetection` right after the raw
  record's dispatch, so the gate depends only on recorded detections and a
  replay rebuilds it (given the level, which is fetched again by URL; its
  size is not in the recording).
- **A spent budget skips the solve** (the TourViewer's §61 #6 short-circuit).
- Only the vote path evaluates this source: b6b's marker must not evaluate
  it for a code with no level (it would be skipped anyway - no size).

## Examples

```ts
const fusedVotes = createQrFusedVotes({
  getQrState: () => storeRef.get().getState(),
  isSpent: (text) => voteBudget.isSpent(text),
});
// fetchLevel: fusedVotes.noteLevelSize(text, level.qr.physicalSizeM)
// onRawDetection (after the dispatch): fusedVotes.onRecorded(raw.text)
// resolveStablePose: (text) => fusedVotes.resolveStablePose(text)
// on a store swap: fusedVotes.resetForStore()
```

## Tests

`qr-fused-votes.test.ts` - a real `qrDetected` slice fed with rendered
corners: no pose before the size is known or before 5 views; at 1 px of
corner noise the fused rotation stays under 2.5 deg over seeds 1-10 while
the newest single-frame solve's median is over 3 deg (the old wiring's vote
pose); a walked-past 0.25 m code is stable at its size and not at 0.16 m;
one evaluation per recorded detection, none once spent; sizes kept and
trackers rebuilt across a swap (mutation-checked); a tracking restart
(`gpsData/odometryTrackingRestarted`) stops the votes; unusable sizes
ignored. The wiring: `wire-qr-recording-fused.test.ts`.
