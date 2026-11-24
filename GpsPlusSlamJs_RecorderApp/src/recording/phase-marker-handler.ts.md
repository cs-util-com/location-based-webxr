# `phase-marker-handler.ts`

## Purpose

The "🏁 Phase" tap during a recording: records the next numbered phase marker ([phase-markers-slice.ts](../state/phase-markers-slice.ts.md)) and confirms it on screen.

## Public API

- `createPhaseMarkerHandler(deps): PhaseMarkerHandler`
  - `deps.getStore()`: the current store (main.ts swaps it per recording).
  - `deps.isStopInProgress()`: true from Stop until the session has ended.
  - `deps.now?()`: epoch-ms clock, `Date.now` by default.
- `PhaseMarkerHandler.markPhase(): number | null`: the recorded number, or null when the tap was refused.

## Feedback (async-ui-feedback rule)

Recording a marker is synchronous store work: one dispatch, with the file write queued by the persistence middleware and drained by Stop before the zip export. There is no awaited work to show progress for, so the rule's "short confirmation" case applies:

- Success: a 1.5 s info toast `Phase N marked`, and the button keeps showing the last number (`🏁 Phase N`, via `setPhaseMarkButtonLabel`).
- Refused (no recording running, or Stop already exporting): a warning toast `Not recording - phase marker not saved`; nothing is numbered and the button is unchanged.

## Invariants and defensive measures

- The gate is the shared [isRecordingActive](../state/recording-active.ts.md), the same one the reference-point mark uses, so a tap is accepted exactly when its action can still reach the zip.
- The number is read from the store (`selectNextPhaseMarkerNumber`) at tap time, so a new store (new recording) numbers from 1 again.
- No GPS, pose or alignment input is read or written.

## Example

```ts
const phaseMarkerHandler = createPhaseMarkerHandler({
  getStore: () => store,
  isStopInProgress: () => recordingSessionHandlers.isStopInProgress(),
});
initUI({
  /* ... */ onMarkPhase: () => {
    phaseMarkerHandler.markPhase();
  },
});
```

## Tests

- [phase-marker-handler.test.ts](phase-marker-handler.test.ts): numbering and timestamps, both toasts, refusal outside a recording and in the stop window, store swap, and the real OPFS/zip round trip.
- [phase-marker-handler.property.test.ts](phase-marker-handler.property.test.ts): strictly increasing 1..n for any interleaving of taps, stop-window taps and taps outside a recording; replay of the persisted actions rebuilds the same markers.
- [phase-marker.spec.js](../../playwright-tests/phase-marker.spec.js): the real button, the toast, the summary count, and the phone layout checks.
