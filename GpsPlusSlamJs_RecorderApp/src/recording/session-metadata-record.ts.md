# `session-metadata-record.ts`

## Purpose

Builds and writes the metadata record a finished recording leaves beside its
data - what the tour browser reads to place a session on a map without unzipping
it, and what a "which build was this?" question is answered from.

## Public API

- `buildSessionMetadataRecord(input): SessionMetadataRecord` - pure. No I/O, no
  clock, no store.
- `writeSessionMetadata(writer, input): Promise<void>` - builds, writes, and
  swallows a write failure.
- `SessionMetadataInput`, `SessionMetadataRecord`. `MetadataGpsPoint` is
  module-private - knip fails the root dead-code check on an exported type
  nobody imports - and is reachable structurally if that changes.

## Invariants & assumptions

- **It decides nothing about stopping.** It is a record builder plus one write.
  The ordering it depends on lives in `performStop`: it must run after the
  persistence queue is drained and before the final sync, so the record
  describes the session the sync is about to upload.
- **A missing `startTime` falls back to `endTime`, and that is a known lie.**
  The session then reports a duration of about zero. The alternative - refusing
  to write - would lose the recording's only self-description over a field that
  is missing exactly when something else has already gone wrong. `performStop`
  logs an error when it happens.
- **A failed write never propagates.** Everything after this point in the stop
  flow ends the session, builds the summary and returns the user to a usable
  screen; a throw here would leave the recording controls up with the Stop
  button stuck on "Stopping…", which is a bricked UI after a good recording.
- **Missing build info is not an error.** It is stamped at deploy time and
  simply absent in a dev server, so it is logged and omitted rather than
  failing the record.
- **`actionCount` is the GPS sample count**, which is what it has always been.
  The name suggests the action log; it does not mean that, and a test pins it so
  nobody "corrects" it.

## Why it is a module

It was 45 lines inside `performStop`, itself inside the 717-line
`createRecordingSessionHandlers`. It is the one part of that pipeline whose
inputs are all VALUES - the sync, the ZIP export and the teardown around it all
close over mutable state of the enclosing factory - so it could move out without
threading anything, which is why it moved first.

The rest of the stop pipeline shares roughly ten pieces of that state (the sync
manager it claims ownership of before awaiting, the store subscription, the last
sync result, the re-entrancy flags). Moving those is a design change rather than
a relocation, and is still open.

## Tests

`session-metadata-record.test.ts` - what the record SAYS, which the 85 tests
around the stop flow do not check because saying so used to require standing up
the whole stop: the times and counts it reports, a de-duplicated coverage index,
an empty index for a walk with no fixes, the known-lie fallback, and a write
failure that does not propagate.
