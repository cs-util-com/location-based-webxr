# qr-fused-pose-source.ts

## Purpose

The fused QR pose per code, for apps (QR near-frontal pose plan
2026-09-23-2314, §60-§61, b4b-3): one `createFusedQrPoseTracker` per decoded
payload, fed by the entries the app reads for it. Moved here from the QR
demo so the demo, the TourViewer and (b6) the recorder share ONE
implementation (DEC-H3).

## Public API

- `createFusedQrPoseSource(config): FusedQrPoseSource`
  - `config.entriesOf(text)` - the code's current-epoch fused entries,
    oldest first; in practice `selectQrFusedEntries(store.getState(), text)`
    (the `ar` layer never imports the state slice, so the app passes it).
  - `config.optionsFor?(text)` - the code's tracker options, above all its
    printed `sizeM`; read ONCE, when the code is first evaluated.
  - `config.onEvaluated?(result, ms, text)` / `config.now?()` - each NEW
    evaluation (never a cached re-read) with its cost and its code, e.g. the
    QR demo's `?qrperf` `fused` stage (plan §30) and the TourViewer's
    per-code `createFusedPoseTally` (plan §66).
  - `evaluate(text)` - evaluate now and return the `QrFusedPose`. Call it
    after every detection when the result drives a readout: the motion
    detector's persistence counts detections, so an app that only reads on
    render would skip some (plan §61 #7).
  - `resolve(text)` - `evaluate`, then the pose when `stable`, else null:
    the shape of the QR controllers' `resolveStablePose`.
  - `last(text)` - the last evaluation, or null if never evaluated.

## Invariants & assumptions

- One tracker per payload for the source's life: two codes never share a
  window, a hysteresis or a motion state. Create a NEW source per AR
  session - a session end does not move the frame epoch, so a kept tracker
  would carry the motion detector's confirmed flags into the next session.
- Solves once per new entries array (the selector's and the tracker's
  caches), however often it is read.
- After a frame change the selector returns no entries, so `resolve` gives
  null until the code is seen again.

## Examples

```ts
const fused = createFusedQrPoseSource({
  entriesOf: (text) => selectQrFusedEntries(store.getState(), text),
  optionsFor: (text) => ({ sizeM: printedSizeOf(text) }),
});
createQrTrackingController({
  // ...
  resolveStablePose: (text) => fused.resolve(text),
});
```

## Tests

`qr-fused-pose-source.test.ts`: nothing until the window is stable, then
the joint rotation; a restart forgets the old frame; codes stay apart; each
code's own options reach its tracker; one solve per new detection however
often it is read; one cost report per new evaluation; `last`.
