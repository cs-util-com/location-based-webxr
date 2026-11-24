# `recording-active.ts`

## Purpose

One predicate for "will an action dispatched now reach the recording's `actions/`?", shared by every recorder handler that records something on a tap: the reference-point mark ([ref-point-handlers.ts](../ref-points/ref-point-handlers.ts.md)) and the phase marker ([phase-marker-handler.ts](../recording/phase-marker-handler.ts.md)).

## Public API

- `isRecordingActive(state: unknown, stopInProgress: boolean): boolean`

## Invariants and defensive measures

- Modelled on the framework persistence middleware's `readIsRecording`, but stricter: only `state.recording.isRecording === true` counts; a missing slice, a missing state or a non-boolean flag reads as false, so a tap is never confirmed on a guess.
- The stop window counts as ended: Stop flushes and exports the zip while `isRecording` is still true, so `stopInProgress === true` always answers false.

## Example

```ts
if (!isRecordingActive(store.getState(), deps.isStopInProgress())) {
  // refuse the tap and say so
}
```

## Tests

- [recording-active.test.ts](recording-active.test.ts): the true case, the stop window, and the malformed states.
- Exercised through [ref-point-handlers.test.ts](../ref-points/ref-point-handlers.test.ts) and [phase-marker-handler.property.test.ts](../recording/phase-marker-handler.property.test.ts).
