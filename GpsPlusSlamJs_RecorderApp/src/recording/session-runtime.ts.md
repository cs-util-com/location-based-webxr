# `recording/session-runtime.ts`

## Purpose

The vocabulary one recording is described in: what it **owns**, and the fallback
scenario name used when it has none.

## Public API

- `SessionRuntime` — interface, nine mutable fields:
  - `writeFailureTracker` / `captureFailureTracker` — warn-once trackers,
    created on start, collected and nulled on stop.
  - `currentSessionName` — `recording-<timestamp>`; the folder and zip name.
    Empty string between sessions.
  - `syncManager` — external-zip sync driver, present only when the user chose
    a save location.
  - `latestQrAnchorOutcomes` — what the last contributor run decided per QR
    code, so a DECLINED anchor is visible on the summary rather than just
    absent.
  - `lastSyncResult` — the zip the session ended up in, external or
    OPFS-generated.
  - `unsubscribeStore` — teardown for this recording's store subscriptions.
  - `imageQualityClient` — the off-thread analyzer worker, `null` when the
    quality gate is off.
  - `absCompassHudTimer` — the live magnetic-heading poll.
- `FALLBACK_SCENARIO` — the single fallback scenario name, aliasing
  `session-zip-naming.DEFAULT_SCENARIO`.

No functions. A type and a constant.

## Invariants & assumptions

- **Mutable on purpose, and every field is nulled by its owner.** These are live
  resources — a worker, a timer, a sync manager, a subscription — whose lifetime
  is the recording's. `readonly` would be a lie. What keeps them honest is that
  each is cleared on the path that stops it, and `cleanupForNewRecording` /
  `reset` clear them again, so a missed clear is visible rather than latent.
- **Created fresh per factory call.** `createRecordingSessionHandlers` builds
  one `runtime` per instance, which is what the factory's "no module-level
  mutable state" invariant actually rests on.
- **The re-entrancy flags are NOT here**, deliberately. `stopInProgress` and
  `backDuringRecordingInProgress` guard a HANDLER against being entered twice
  rather than describing a resource: each is false again before its handler
  returns, while everything here outlives the call that created it. A guard also
  has to stay where its handler is — one that travelled into
  `stop-recording.ts` would be re-created per call and guard nothing.
- **Why it is a separate module at all.** Both the handler factory and the
  extracted stop flow need these. Leaving them in
  `recording-session-handlers.ts` would have made `stop-recording.ts` import
  its own caller.
- **`FALLBACK_SCENARIO` is an alias with a contract attached**: the recording
  pipeline and the replay browser's metadata-merge must agree on this string, or
  the "missing-metadata + Default Scenario" merge silently breaks for
  newly-recorded zips. That is why it is one exported constant rather than a
  literal at each site.

## Examples

```ts
const runtime: SessionRuntime = {
  writeFailureTracker: null,
  captureFailureTracker: null,
  currentSessionName: '',
  syncManager: null,
  latestQrAnchorOutcomes: [],
  lastSyncResult: null,
  unsubscribeStore: null,
  imageQualityClient: null,
  absCompassHudTimer: null,
};

await performStop(runtime, deps);
```

## Tests

None of its own — it declares a shape and a string, with no behaviour to
exercise. It is covered indirectly, and thoroughly, by the 85 tests in
`recording-session-handlers.test.ts`: every one drives a real `runtime` through
the factory, and the migration that introduced this module changed none of them.
