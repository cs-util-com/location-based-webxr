# qr-viewer-mode.ts

## Purpose

Viewer mode's view-model (QR-pose plan M4): the tracking-controller
configuration that relocalizes a visitor against a tour's printed codes,
carrying the two review-ordered guardrails and the deferred negative cache.

## Public API

- `VIEWER_SYNTHETIC_ACCURACY_M = 5`, `VIEWER_VOTE_BASELINE_M = 2` (delta
  #6 cap — only M5's measurements may raise it), `VIEWER_VOTE_COUNT = 4`,
  `MAX_VOTED_LOCKS_PER_CODE = 10` (review #6 budget; M5 tunes).
- `buildViewerControllerConfig(deps: ViewerPipelineDeps)` — deps: the QR
  device quartet plus `getLevels` (live, from the open tour),
  `dispatchVote` (one payload → `recordGpsEvent`), `recordDetection`,
  `onError`, and the optional `onStatus` / `onUnknownCode` /
  `onVotedLock` UI hooks.
- `viewerStatusLine({...}): string` — the visitor-facing line, pure.
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
- The DETECTED code's `&c=` wins over the page's launch param
  (`codeFromDetectedText`); votes only flow once the session has a zero
  reference (the store drops `recordGpsEvent` while `gpsData` is null —
  matching production, where the GPS watch starts with AR).
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

`qr-viewer-mode.test.ts` — the 2 m baseline pin, level resolution by
detected code, the placeholder + `onUnknownCode`, the per-code budget
(stops exactly at the cap, other codes unaffected, detections keep
recording), the status-line table, and the ring geometry. The composed
loop (real vote builder → real store, budget spend, marker, image ring) is
proven by `playwright-tests/ar-mode.spec.js`'s viewer specs.
