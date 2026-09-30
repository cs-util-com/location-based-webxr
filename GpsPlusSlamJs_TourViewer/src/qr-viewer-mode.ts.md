# qr-viewer-mode.ts

## Purpose

Viewer mode's view-model (QR-pose plan M4): the tracking-controller
configuration that relocalizes a visitor against a tour's printed codes,
carrying the two review-ordered guardrails and the deferred negative cache.

## Public API

- The measured vote geometry (authoring plan 2026-09-28-0953, M0b/M0c/M2a;
  [results](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-1433-viewer-vote-strength-results.md)):
  `VIEWER_VOTE_BASELINE_M = 30` (ring radius in the code's plane),
  `VIEWER_VOTE_COUNT = 16` (votes per lock and per keep-alive fix at full
  strength; owner decision D13 on M2a's count lever: 8 left the code
  0.31-0.58 m off after 8+ minutes of GPS before the scan, 16 met the rule
  on every measured arm up to a 15-minute walk), `VIEWER_SYNTHETIC_ACCURACY_M = 5`
  (barely matters: the core weighs `1/max(acc, 1 m)^0.1`), and
  `MAX_VOTED_LOCKS_PER_CODE = 10` (review #6 budget). The ring used to be
  capped at 2 m (delta #6: "a wide ring amplifies the saved code's heading
  error"); M0b measured that it does not, and that the 2 m ring left the
  heading 6-31° off after a scan. `VIEWER_KEEP_ALIVE_HOLD_MS = 120000` and
  `VIEWER_KEEP_ALIVE_FADE_MS = 120000` (the owner's "about two minutes, then
  fade", M0c). Each constant's doc comment names what would reverse it.
- `createViewerKeepAlive()` - the code keep-alive (`qr-vote-keep-alive.ts`)
  with these constants.
- `buildViewerControllerConfig(deps: ViewerPipelineDeps)` — `onLocked(level,
hasVoted)` is forwarded from every controller lock (no detected-text
  guard, M5 review #4), with whether the locked code has cast votes in
  this AR entry (the scan gate passes only then; authoring plan
  2026-09-28-0953 §2.2 B3); the framework reports the lock AFTER the
  frame's votes, so `onVotedLock` may precede it. Deps: the QR
  device trio (`frontEnd`, `solvePose`, `getIntrinsics` - no pose reader since
  QR perf plan 2026-09-23 M4; each frame carries its capture pose) plus `getLevels` (live, from the open tour),
  `dispatchVote` (one payload → `recordGpsEvent`), `canAcceptVotes` (the
  budget must NOT be charged while the store drops votes — before the
  first GPS fix), `resolveStablePose` (the same convergence gate minting
  uses - the fused pose since plan §60; the controller skips unconverged
  votes with the budget untouched, and the config stops asking once the
  code's vote budget is spent - ~10 ms per lock saved, §61 #6),
  `recordDetection`, `onError`, and the optional `onStatus` /
  `onUnknownCode` / `onUnusableLevel` (a level with geo but no printed
  size) / `onVotedLock` UI hooks, and the optional `keepAlive`: each lock
  that dispatched votes hands it the stable pose the controller resolved
  for that frame (with the level's geo and size) - after the budget the
  config no longer resolves a pose, so this is the only place it can be
  kept - and every other lock of a code is a re-scan (`relock`). `onLocked`
  is present when the app listens or a keep-alive is given.
- `viewerStatusLine({...}): string` — the visitor-facing line, pure;
  carries the last lock's reprojection error (px) as the placement-quality
  number M5's probe reads. Its optional `fusedHint` (from
  `qr-debug-readout.ts`'s `visitorFusedHint`, plan §66) is shown before the
  first vote instead of "Scanning for the printed code…"; an unknown or
  unusable code still wins, and the vote states replace it. Its optional
  `hold` (the keep-alive's phase) decides the spent-budget line: "the code
  holds the placement for N s more", "the code's hold is fading; GPS takes
  over gradually", or "the code's hold has ended - GPS places the tour now";
  without a phase for the locked code it only says the batches were cast.
  It used to say "placement holds" unconditionally while the votes faded
  out of the solve (authoring plan §2.2 B1).
- `imagePlaneRingNue(centerNue, count, radiusM?)` — ring positions in
  GPS-world NUE at the anchor's height.

## Invariants & assumptions

- **The vote budget is per code and hard** (review #6): the controller
  dispatches a fresh vote set on EVERY locked frame, so an unbounded
  visitor standing at the poster injects thousands of near-identical
  synthetic points and pins the alignment centroid. Budget keying relies
  on the controller's documented ordering contract — `onDetection` fires
  synchronously before the same frame's vote dispatch.
- **The negative cache is a resolved geo-less placeholder** (delta #8): a
  rejecting `fetchLevel` would flap the controller error↔scanning at the
  detection cadence; the placeholder is cached per decoded text by the
  controller and simply never solves or votes. `onUnknownCode` tells the
  visitor in plain words.
- A code's identity is `qrCodeId(decoded text)` — the hash of the exact
  printed string. There is no page-level fallback and no visible code
  number: distinct texts are distinct codes by construction, which is also
  why the vote budget can key by text
  ; votes only flow once the session has a zero
  reference (the store drops `recordGpsEvent` while `gpsData` is null —
  matching production, where the GPS watch starts with AR) — and the
  budget is NOT charged while they would be dropped.
- **The controller's per-text level cache outlives level changes** — the
  app calls `qrController.reset()` whenever `loadQrLevels` installs or the
  tour closes, or a late-arriving tour could never relocalize (and a
  closed one would keep voting).
- **V1 deviation, deliberate:** recording zips carry no per-image GPS
  (images store odom pose only), so the image ring sits around the anchor
  instead of at capture positions — a capture-time geo join is future work.

## Examples

```ts
const controller = createQrTrackingController(
  buildViewerControllerConfig({
    ...deviceQuartet,
    getLevels: () => currentLevels,
    dispatchVote: (p) => store.dispatch(recordGpsEvent(p)),
    ...uiHooks,
  }),
);
```

## Tests

`qr-viewer-mode.test.ts` — the measured-geometry pin (30 m, 16 votes), the
`hasVoted` lock adapter, the keep-alive hand-over (a voted lock keeps its
pose past the budget, a lock without votes keeps nothing, a later lock
restarts the hold), the hold and fade pins, the hold lines, level resolution by
detected code, the placeholder + `onUnknownCode`, the per-code budget
(stops exactly at the cap, other codes unaffected, detections keep
recording), the status-line table, and the ring geometry. The composed
loop (real vote builder → real store, budget spend, marker, image ring) is
proven by `playwright-tests/ar-mode.spec.js`'s viewer specs.
