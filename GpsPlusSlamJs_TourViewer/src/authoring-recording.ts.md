# authoring-recording.ts

## Purpose

The creator's troubleshooting recording: once the creator opts in, every
persisted action of the page's store is written to an OPFS folder of its own,
and "Save the recording" hands that folder over as
`tour-recording-<UTC timestamp>.zip` - a zip the Recorder's desktop replay
loads. Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1a (decisions D4, D6; review findings 1, 2, 16).

## Public API

- `createAuthoringRecording({ openRoot, contextTag?, holdFolder? }): AuthoringRecording`
  - `openRoot` resolves the OPFS root (`navigator.storage.getDirectory`) or
    rejects.
  - `contextTag` - `session.json`'s tag: `"tour-authoring"` (the default) or
    `"tour-viewing"` (a visitor's `?debug=1` recording, M1b).
  - `holdFolder(name): Promise` - awaited BEFORE the folder is created
    (M1b review #2); the page holds the folder's Web Lock for its life
    (`holdRecordingFolder`), so the next page's orphan offer and cleanup skip
    it. The name is the one `createSessionInDirectory` will pick (the same
    probe, run ahead of it); when another tab takes it in between, the
    suffixed name the framework picked is locked right after.
  - `storageBackend` - handed to `createTourViewerStore`.
  - `persistWhile()` - the store's persistence gate: true from `start()` until
    the folder could not be made.
  - `status(): RecordingStatus` - `off`, `on` (with the count of failed
    writes) or `failed` (with the reason).
  - `start(at: Date)` - makes the folder (async) and opens the gate at once;
    writes queued meanwhile wait for the folder. Idempotent: one recording per
    page life.
  - `save({ flush, nowMs, userAgent, pageUrl, getBuildInfo? })` - flushes
    the store's write queue, writes `session.json` (stamped with
    `getBuildInfo()`, the framework's `utils/build-info` reader in the page),
    zips the folder (`packRecordingFolder`, shared with the orphan save in
    `recording-folders.ts`); resolves a `PackedRecording`
    `{ blob, filename, actionCount, metadataError?, markSaved(atMs) }`.
    Rejects when nothing was started, when the folder could not be made, or
    when the flush or the zip fails - the caller surfaces it. A `session.json`
    that cannot be written does not reject: see "Save zips what is on disk".
    The caller marks the folder saved only after a hand-off that delivered
    (`handOverRecording` in `recording-panel.ts`).
- The zip's name (`recordingFileName`) and the context tags live in
  `recording-folders.ts` since M1b.
- `RECORDING_DEPTH` - the depth sampler's config while recording.
- `RECORDING_BYTES_PER_SECOND`, `LOW_STORAGE_BYTES`,
  `lowStorageWarning(estimate): string | null` - the measured write rate, the
  free-space threshold derived from it, and the warning the panel shows at
  opt-in (null with room, or without a usable estimate). See "Storage cost".
- `type RecordingStatus`.

## Invariants & assumptions

- **Silent until started.** The store is built at page boot with this backend
  and gate; before `start()` the gate is false, so no action reaches the
  backend and nothing is created in OPFS - a creator who never opts in, and
  every visitor, pays nothing.
- **Its own folder:** `gps-plus-slam/tour-viewer/recording-<ts>/` (`actions/`,
  an empty `images/`, `session.json`), made by the framework's
  `createSessionInDirectory` and written by the framework's OPFS write
  functions (which then target it). Never the Recorder's `sessions/`: both apps
  share one origin, and the framework's `OpfsStorageBackend` writes there.
- **The Recorder's layout, era 5.** `session.json` comes from the framework's
  shared builder: `odomCoordVersion: 5`, `contextTag: "tour-authoring"`,
  `frameCount: 0`. Its `actionCount` and H3 coverage come from the GPS
  actions THIS recording wrote (each fix of a `gpsData/recordGpsEvent` and of
  a `gpsData/recordGpsEventBatch`, through `recording-folders.ts`'s
  `recordedFixes`) - the store's own GPS data is wiped at every AR exit.
  `startedAt` is the moment the recording started. The page url is passed in
  query-free.
- **One numbering for the whole recording.** The store numbers across its AR
  sessions (`continuousActionIndex`), so a second visit never overwrites the
  first; the gate replaces `isRecording`, so each exit's
  `resetGpsSessionData` and everything done on the page (the Finish) are
  written too - which is what makes a replay give each visit its own
  alignment.
- **Never part of the tour zip.** The visitor's geo join replays any
  `actions/` + `session.json` in a tour zip; this zip is only handed over on
  its own, under a name that cannot collide with the tour's.
- **Save is a snapshot.** Recording continues after a save; a later save
  rewrites `session.json` and zips everything again. The saved marker counts
  the action files a save handed over, so an action recorded after it makes
  the folder unsaved again (offered on the next open if the tab is killed;
  `recording-folders.ts`).
- **Failures are counted, not swallowed.** A failed action write is counted
  (`status().failedWrites`) and rethrown to the middleware, which dispatches
  `recordWriteFailure`. A folder that cannot be made switches the gate off and
  says why (`status().kind === "failed"`).
- **Depth while recording (decision D4):** `RECORDING_DEPTH` = one sample per
  1000 ms ("about 1 Hz" in the plan), a 16 x 16 grid (the framework sampler's
  default; the Recorder records 24 x 24 at 5 Hz for reconstruction), no
  per-point colour (a camera read-back per sample). Its size on disk is
  measured (below); the frame-time cost on a phone is NOT (plan §5, a field
  checklist item).
- **Save zips what is on disk.** When `session.json` cannot be written (a full
  disk refuses the last, small file), the actions already written are zipped
  all the same and `metadataError` says why; an EMPTY `session.json` the
  refused write left behind is removed first, because the Recorder's loader
  parses any `session.json` it finds and an empty one would stop the whole
  recording loading. (An earlier save's complete file is kept: an aborted
  write leaves the old content.) Without `session.json` the Recorder takes the
  zip for era 1 and migrates it, which is why the panel says the replay may
  be misaligned.
- **Build stamp.** `session.json`'s `build` (commit, versions, build time)
  comes from the `getBuildInfo` the page passes to `save` - the framework's
  reader of the constants the Tour Viewer's `vite.config.ts` defines. Where
  they were never injected the reader throws and only the field is dropped.
- **What a recording holds, and the line that says so.** The recorded QR
  texts (`qrDetected/*`, and `text` in `tourAuthoring/*` / `tourViewing/*`)
  carry the tour's link; the fixes carry the recorder's GPS track; the depth
  samples (`RECORDING_DEPTH`, about one a second) carry the 3D shape of the
  surroundings. The line beside the switch names all three: "The recording
  holds the tour link, your GPS track and the 3D shape of the surroundings."
  (`index.html`; the depth was missing from it until the M1b review, #6).
  `session.json`'s `pageUrl` is query-free (`sanitizedPageUrl`) as before.
- **Privacy: the tour link is kept, deliberately - and NOT because a replay
  needs it** (corrected in the M1b review, #6). A replay needs each
  detection's and each vote batch's code IDENTITY, which a hash of the text
  would give as well; the link's CONTENT is not what a replay needs. The
  earlier reasoning ("a replay needs the link") confused the two. What
  actually decides it, for the creator's recording and the visitor's alike:
  - it needs an explicit opt-in: the creator's switch, and for a visitor
    `?debug=1` (a link the tour's owner hands out for troubleshooting, never
    the printed code's) AND the switch, whose line says what it holds; a
    visitor without `?debug=1` gets no switch, no recording, no log actions;
  - the zip never leaves the phone unless the person saves and hands it
    over (the recording is on the phone's private storage until then);
  - whoever debugs the session - the tour's owner - already has the tour
    link, so keeping it discloses nothing to the one reader the zip is made
    for. Stripping it would protect only against a zip sent to someone
    else, which the person chooses on the share sheet.
  - What would reverse it: recordings routinely shared beyond the tour's
    owner (a public issue tracker, say), or a private-link tour whose
    visitors' zips reach people without the link; then the texts should be
    replaced by their code ids at record time.
- **What runs on a visitor's `?debug=1` page before any opt-in.** The
  recording itself writes nothing until the switch is on and AR starts. The
  page-open housekeeping (`recording-housekeeping.ts`) DOES run at page
  open, before the opt-in, wherever the switch shows: it reads this app's
  recording folders on the phone, deletes what the cleanup bound names, and
  offers a killed tab's unsaved recording. It only reads and deletes; it
  creates and writes nothing.
- **Visitor recordings (M1b).** With `?debug=1` a visitor's page wires the
  same panel; the recording is tagged `tour-viewing` (`contextTag`) and
  records depth like the creator's (the AR entry is mode-agnostic).
- **Module-level OPFS handles.** The framework's write functions write to the
  session `createSessionInDirectory` set last. Nothing else on this page uses
  them (the draft store has its own handles).

## Storage cost and the low-storage threshold

MEASURED (`authoring-recording.test.ts` "what a recording costs on disk"):
the framework's real depth sampler at `RECORDING_DEPTH`, over float32
depths, pose and projection matrix (a phone's digit counts), written through
the real store into the OPFS mock and read back as bytes:

- one depth sample: **1 829 bytes since scan pass S2** (2026-10-08: the grid
  packed as float32 and the JSON compact, framework
  `depth-sample-codec.ts`); 34 285 bytes before, as pretty-printed JSON
  (2026-09-28);
- the other actions - GPS fixes, QR detections while a code is in view, the
  `tourAuthoring/*` log - at the owner's field recording's rate
  (`FIELD_OTHER_ACTIONS_BYTES_PER_SECOND` = 1 950: 411 617 bytes in 211 s
  as written since S2, measured by the opt-in field test on the 2026-10-06
  recording; 3 430 as the pretty JSON it was written in). Before S2 these
  were about 10 % of a second's bytes and were left out; now they are about
  half of it;
- so one second of recording writes about 3.8 KB, about 13.6 MB an hour
  (the whole field recording: 760 KB of actions in 211 s, was 7.46 MB).
  `RECORDING_BYTES_PER_SECOND` = 4 500 covers that, and the test
  holds it within 25 % above the sum, so a bigger grid or a format change
  cannot drift past it unseen.
- NOT counted: the file system's own per-file overhead (one file per
  action). Since S2 most files are well under a disk block, so on a phone's
  disk a second can take more than its bytes: about 3.8 KB at no overhead
  to about 13.5 KB at a 4 KiB block for every one of the field recording's
  3.3 files a second (the M5d + S2 milestone review's #3). Whether the
  browser's storage quota counts blocks or bytes is not measured; if it
  counts blocks, "about N minutes" overstates by up to about 3.6x, and the
  one-hour threshold covers about 20 minutes.
- **The storage is not what ends a long recording.** The archive's entry cap
  (20 000 files, `archive-limits.ts`) is reached after about 1.7 h at the
  field recording's 3.3 actions a second, long before the bytes matter
  (scan pass S2 plan §2, an owner question).

`LOW_STORAGE_BYTES` = one hour at that rate (16.2 MB, 15.4 MiB). Weighed over
a plausible range of 15 minutes to 2 hours of headroom (4 to 32 MB):

- An authoring visit (measure a code, place a handful of notes, finish) is
  minutes to tens of minutes; an hour covers a long one with a margin.
- Too high costs a warning on a phone that had room (it never blocks); too
  low lets a recording run into the wall, where its writes fail part-way
  (counted on the marker) and the zip is incomplete. The cheaper mistake is
  the false warning, so the threshold sits at the upper-middle of the range.
- What would change it: a measured write rate well above 6 KB/s (a
  field recording with long code-in-view stretches), or sessions routinely
  longer than an hour - either argues for 2 hours. Below 15 minutes of
  headroom the warning would miss a normal session and is not considered.
- The estimate is this page's share (`quota - usage` from
  `navigator.storage.estimate()`), which is what OPFS can use - not the
  disk's free space. On Chrome for Android the quota is a large fraction of
  the free disk, so a warning mostly means the phone itself is nearly full.

## Examples

```ts
const recording = createAuthoringRecording({
  openRoot: () => navigator.storage.getDirectory(),
});
const store = createTourViewerStore(recording);
recording.start(new Date()); // at the AR entry, when opted in
const { blob, filename, metadataError } = await recording.save({
  flush: () => store.flushPendingActionWrites(),
  nowMs: Date.now(),
  userAgent: navigator.userAgent,
  pageUrl: sanitizedPageUrl(location.href),
  getBuildInfo, // gps-plus-slam-app-framework/utils/build-info
});
lowStorageWarning(await navigator.storage.estimate()); // at opt-in
```

## Tests

`authoring-recording.test.ts` (the real page store, the framework's OPFS mock,
the real zip export, read back with `loadActionsFromZip` + `replayActions`):

- nothing is written anywhere before `start()`, and `save()` refuses;
- two AR visits with a page-side Finish between them: numbered 1..N without a
  restart, both resets and the Finish in the stream; replaying up to the first
  exit reproduces visit 1's live alignment, the whole stream visit 2's, and the
  same stream WITHOUT the resets does not (the reset is what separates them);
- the saved zip holds `session.json` (era 5, the tag, the start time, the
  coverage and count from the recorded fixes after the store's were wiped) and
  `actions/NNNNNN.json` only, in `gps-plus-slam/tour-viewer/`, with no
  `sessions/` folder created;
- a folder that cannot be made switches the gate off and reports the reason;
- `session.json` carries the build stamp passed in;
- a `session.json` the disk refuses (file created, write refused) still
  yields the zip of the actions, without the empty file, and `metadataError`;
  a written one leaves no error;
- the order the page writes, driven as the page drives it (the recording
  started before the session, fixes through the framework's GPS handler, a QR
  lock, a depth sample, the log actions, two visits' teardowns) - the
  sequence the Recorder's loader test copies;
- what a recording costs on disk (above), and `lowStorageWarning` at, under
  and over the threshold and without an estimate;
- the saved marker: unsaved after the pack, saved after `markSaved`, unsaved
  again once more is recorded (M1b);
- a `tour-viewing` recording's tag, and the folder lock taken BEFORE the
  folder exists, a suffixed name's too when another recording took the name
  in the same second (M1b).

The Recorder's loader accepting this layout is pinned on its side
(`RecorderApp/src/storage/recording-loader.test.ts`, "a Tour Viewer authoring
recording"). End to end: `playwright-tests/ar-mode.spec.js`.
