# sun-sighting-note.ts

## Purpose

Logs an accepted sun-check Mark into the running recording, as a
`diagnostics/note` of kind `sun-sighting` (sun-overlay plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-0100-ar-sun-overlay-heading-check-plan.md`
§6.3). With the notes in the recording, the Investigation can later re-derive
the heading error offline for any solver preset (M5).

## Public API

- `createSunSightingRecorder({ getStore, isStopInProgress, isReplaying, nowEpochMs? })`
  returns a function to call at a Mark's PRESS. That function binds the
  store current then and returns the Mark's recorder,
  `(sighting) => 'recorded' | 'not-recording'` (`SunSightingRecord`).
- `SUN_SIGHTING_KIND` = `'sun-sighting'`.
- `SunSighting`: the framework controller's record type, named through
  `SunCheck['mark']`.

## Invariants & assumptions

- **One note per accepted Mark.**
  - The envelope's `atMs` is the DISPATCH time. The replay engine paces
    notes by it, and the Mark's middle frame is up to ~3 s older, which
    would stretch the replay's pacing. The middle frame stays in
    `detail.atMs`, the measurement's time.
  - `detail` is the sighting, flat: `schema: 1` and about 35 scalars. The
    action's contract only allows flat scalars.
- **The note is dispatched only when a recording will keep it.** All three
  conditions must hold:
  - `recording.isRecording` is true. This mirrors the persistence
    middleware's gate, as `ref-point-handlers.ts` does.
  - No Stop is in progress. Stop flushes the action writes before the zip
    export and ends the session only after it, so a note dispatched in
    between would pass the gate above and still miss the zip
    (`isStopInProgress` in `recording-session-handlers.ts`).
  - No replay store is installed. A live Mark never goes into a replayed
    recording.
  - Otherwise nothing is dispatched, and the caller says "not recorded".
- **Bound at the press.** The store is read at the press and again at the
  result, and never captured at creation, because the recorder swaps stores
  per recording. If the store changed while the Mark ran, the answer is
  `'not-recording'`: a sighting belongs to the recording it was measured in,
  since it carries that recording's place and alignment.
- Refused Marks are not logged (owner default Q4).

## Example

```ts
const record = createSunSightingRecorder({
  getStore: () => storeRef.get(),
  isStopInProgress: recordingSessionHandlers.isStopInProgress,
  isReplaying: replayHandlers.getIsReplayMode,
});
record(result.sighting); // 'recorded' | 'not-recording'
```

## Tests

`sun-sighting-note.test.ts` covers:

- the note's exact action;
- nothing dispatched outside a recording (both `isRecording` false and a
  missing slice), during a stop, or into a replay store;
- the store read at call time.
