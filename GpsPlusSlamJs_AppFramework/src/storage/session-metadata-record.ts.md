# `session-metadata-record.ts`

## Purpose

Builds and writes the metadata record (`session.json`) a finished recording
leaves beside its data - what the tour browser reads to place a session on a
map without unzipping it, what the Recorder's replay reads to decide whether a
recording needs migrating (`odomCoordVersion`), and what a "which build was
this?" question is answered from.

Two apps write it: the Recorder (at Stop) and the Tour Viewer's
troubleshooting recording (at "Save the recording"). It moved here from
`GpsPlusSlamJs_RecorderApp/src/recording/` on 2026-09-28 for that reason
(DEC-H3: shared behaviour has one implementation), with the build info
injected instead of read from the Recorder's `utils/build-info`. Plan:
[2026-09-28-0953 authoring recording plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, decision 2 of M1a.

## Public API

- `buildSessionMetadataRecord(input): SessionMetadataRecord` - pure. No I/O,
  no clock, no store.
- `writeSessionMetadata(writer, input): Promise<void>` - builds, writes, and
  swallows a write failure. Not the same function as `opfs-storage`'s
  `writeSessionMetadata` (that one IS a writer; this one is handed one).
- `sanitizedPageUrl(href): string | undefined` - the page url without its
  query and hash; `undefined` for a missing or empty url.
- `SessionMetadataInput` (with the optional `getBuildInfo` getter),
  `SessionMetadataRecord`. `MetadataGpsPoint` and `SessionBuildInfo` are
  module-private - knip fails the root dead-code check on an exported type
  nobody imports - and reachable structurally if that changes.

## Invariants & assumptions

- **It decides nothing about stopping.** It is a record builder plus one write.
  The ordering it depends on lives in the caller: it must run after the
  persistence queue is drained (`flushPendingActionWrites`), and in the
  Recorder before the final sync, so the record describes the session that is
  about to be exported.
- **`odomCoordVersion` is 5**, the current era. Without the field the
  Recorder's loader migrates a recording as era 1 - wrong for anything
  recorded today.
- **A missing `startTime` falls back to `endTime`, and that is a known lie.**
  The session then reports a duration of about zero. The alternative - refusing
  to write - would lose the recording's only self-description over a field that
  is missing exactly when something else has already gone wrong. The Recorder
  logs an error when it happens.
- **A failed write never propagates.** A throw at the end of a stop flow leaves
  its button stuck busy after a good recording.
- **Build info is injected, and its absence is not an error.** `getBuildInfo`
  is optional and may throw (the constants are stamped at deploy time and absent
  in a dev server); either way the record simply has no `build` field. The
  Recorder passes its `utils/build-info` reader; the Tour Viewer passes none.
- **`actionCount` is the GPS sample count**, which is what it has always been.
  The name suggests the action log; it does not mean that, and a test pins it so
  nobody "corrects" it. The Tour Viewer counts the GPS actions its recording
  wrote, because its store's GPS data is wiped at every AR exit.
- **`pageUrl` is absent, not `undefined`, without a url**: the persisted
  shape declares it optional, and a consumer compiled with
  `exactOptionalPropertyTypes` cannot pass an explicit `undefined` to the
  writer. The written JSON is the same either way.
- **The page url leaves the device query-free.** A Tour Viewer launch carries
  the tour's link in `?qr=`, possibly a private Drive link.

## Examples

```ts
import {
  sanitizedPageUrl,
  writeSessionMetadata,
} from 'gps-plus-slam-app-framework/storage/session-metadata-record';

await writeSessionMetadata((record) => store.writeSessionMetadata(record), {
  endTime: Date.now(),
  startTime: startedAtMs,
  contextTag: 'tour-authoring',
  gpsPositions: recordedFixes,
  frameCount: 0,
  userAgent: navigator.userAgent,
  pageUrl: sanitizedPageUrl(location.href),
});
```

## Tests

`session-metadata-record.test.ts` - what the record SAYS: the times and counts
it reports, the era, a de-duplicated coverage index, an empty index for a walk
with no fixes, the known-lie fallback, the injected build info and its
omission (absent or throwing), a missing page url left out of the record, the page url's query and hash stripped
(including an opaque-origin url and an unparseable string), and a write
failure that does not propagate. The Recorder's stop-flow tests
(`recording-session-handlers.test.ts`) still cover the call through the stop.
