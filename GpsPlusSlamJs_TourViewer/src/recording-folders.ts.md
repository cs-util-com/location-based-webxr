# recording-folders.ts

## Purpose

The troubleshooting recordings ON DISK, across page lives: which recording
folders exist, which of them were saved, packing a folder into its zip,
rebuilding the `session.json` of a folder whose page was killed, the Web Lock
a live page holds on its folder, and which folders the cleanup deletes. Plan:
[authoring recording plan](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§3.1, M1b (and §7a, the M1a review's finding 3: cleanup and saved vs unsaved).

The live recording (`authoring-recording.ts`) writes a folder; this module is
everything that reads or removes folders, and the one packing path both the
live save and the orphan save take.

## Public API

- `AUTHORING_CONTEXT_TAG` (`"tour-authoring"`), `VIEWING_CONTEXT_TAG`
  (`"tour-viewing"`), `type RecordingContextTag` - `session.json`'s tag.
- `openRecordingsDir(root, create)` - `gps-plus-slam/tour-viewer/`, or null
  when it does not exist (without `create`, nothing is created while looking).
- `recordingStartOf(name)` - the start time a `recording-<UTC ts>[-N]` name
  carries, or null for any name this app did not write (a calendar-impossible
  date included: the parse is checked by formatting it back).
- `recordingFileName(startedAt)` - `tour-recording-YYYY-MM-DD_HH-MM-SSutc.zip`.
- `listRecordingFolders(dir, skip?)` - every recording folder, oldest first,
  as `RecordingFolder { name, startedAtMs, actionFiles, savedAtMs, saved }`,
  without those in `skip`; an unreadable folder is left out.
- `countActionFiles(folder)` - the action files by name (a directory
  listing). (The marker is written through the pack's `markSaved`, with the
  count of files that hold content; that count and the orphan metadata
  builder behind `packOrphanRecording` are module-private.)
- `recordingsToDelete(folders, nowMs, bounds?)` - pure: the names the cleanup
  deletes. `SAVED_RECORDING_MAX_AGE_MS` (7 days), `SAVED_RECORDINGS_KEPT` (3).
- `tidyRecordings(dir, held, nowMs)` - the page-open housekeeping: list,
  delete what `recordingsToDelete` names (a refused delete is skipped), return
  the unsaved recordings to offer.
- `deleteRecordingFolder(dir, name)` - recursive; rejects when OPFS refuses.
- `packRecordingFolder(folder, startedAt, writeMetadata, zip?)` ->
  `PackedRecording { blob, filename, actionCount, metadataError?, markSaved(atMs) }`.
  `zip` defaults to the framework's `exportSessionHandleAsZip`; the tests wrap
  it to write while the zip is built.
- `packOrphanRecording(dir, name, environment, fallbackTag)` - drop the
  folder's empty action files, rebuild its `session.json` from its own files,
  write it, pack.
- `recordedFix(action)` - a recorded GPS action's fix, or null.
- `holdRecordingFolder(locks, name)`, `heldRecordingFolders(locks)` - the Web
  Lock a live page holds on its folder, and the folders whose lock is held.

## Invariants & assumptions

- **Saved is a marker with a count, written after the hand-off.** See
  "Why this marker" below. A folder is saved when its marker reads and names
  at least as many action files as the folder holds; a marker that does not
  read counts as unsaved (offered again, never deleted).
- **The count is taken BEFORE the zip, and counts only files with content**
  (M1b review #3). OPFS creates an action file empty at
  `getFileHandle({ create: true })` and fills it only when the write closes,
  so a write in flight at the save is a name with no content, and the zip
  holds it empty; counted by name, the marker would cover it and the cleanup
  could delete the action the zip lacks. An action created while the zip is
  built, one still being written, or one recorded after the save (a
  recording runs on after a save) makes the folder unsaved again. Every
  error is "offered once too often", never "deleted with an action the author
  did not get".
- **The page-open listing counts NAMES** (a directory listing, no file
  reads), the marker counts CONTENT: a name count can only be higher, which
  is the unsaved direction. So that a saved orphan is not offered forever,
  the orphan save first removes the empty action files a killed tab left
  (its unclosed writes, which nothing will fill).
- **Nothing unsaved that holds actions is ever deleted here.** Only the
  offer's "Delete it" removes one. A folder with no action file at all has
  nothing to save and is deleted by the cleanup.
- **Only this app's folders.** Anything under `tour-viewer/` that is not a
  `recording-<UTC ts>[-N]` directory (a file, `drafts`, a malformed name) is
  neither listed nor deleted.
- **A live page's folder is untouchable.** The recording page holds a Web
  Lock named after its folder for its whole life (a request whose callback
  never settles); the browser releases it when the page goes - exactly "the
  tab was killed". The page-open housekeeping skips held folders, so a folder
  another open tab records into is neither offered nor cleaned up. Without
  Web Locks nothing is held or known held: the other tab's folder could then
  be offered, and deleting it would make that tab's writes fail visibly (its
  marker counts failed writes).
- **The orphan's `session.json` is built from its own files.** Start: the
  folder's name. End: the newest action file's modification time. Coverage
  and `actionCount`: its GPS actions. Tag: an earlier save's `session.json`,
  else its log actions (`tourViewing/*` only -> viewing, `tourAuthoring/*`
  only -> authoring), else the saving page's own (a recording with neither
  kind of log action is one where nothing was placed or locked). A truncated
  action file (what a killed write leaves) is skipped, as the Recorder's
  loader skips it. Every action file is read and parsed once (about 125 MB
  per recorded hour, the same order as the zip reads) - ordinary code
  rather than a partial-read trick, for a save that happens rarely and
  shows a busy state.
- **A refused `session.json` does not fail the pack** (M1a review finding
  3): the actions are zipped, `metadataError` says why, and an empty file
  the refused write left behind is removed (the Recorder's loader parses any
  `session.json` it finds). A failing zip rejects.

## Why this marker

The simplest DURABLE marker that tells a killed tab's folder from a saved one:

- **`session.json`'s presence: rejected.** Save writes it before the hand-off,
  so a share sheet the author closed would count as saved; and a recording
  continued after a save keeps the earlier file.
- **Renaming the folder: rejected.** OPFS has no portable directory rename,
  and the live page's write handles point into the folder.
- **A `localStorage` flag: rejected.** It lives apart from the folder, is
  cleared independently of it, and the two can disagree.
- **A marker file inside the folder, holding the action count: chosen.** It
  lives and dies with the folder (one recursive delete), is one small write
  after a hand-off that delivered, and the count makes "recorded on after
  the save" and "an action landed during the zip" fall to unsaved without
  the live page keeping a dirty flag. It is written through a
  `DraftFileStore` over the folder - the draft machinery's never-throwing,
  abort-on-failure key file (`saved.blob`).
- **Its cost:** a later save's zip carries the earlier `saved.blob`; the
  loaders read only `session.json` and `actions/` (pinned in
  `RecorderApp/src/storage/recording-loader.test.ts`, "a Tour Viewer viewing
  recording"). The listing counts each saved folder's action files at page
  open - a directory listing, no file reads.

## Cleanup bound

`SAVED_RECORDING_MAX_AGE_MS` = 7 days after the save, `SAVED_RECORDINGS_KEPT`
= 3 (the most recently saved). The parameters it rests on:

- the measured rate, about 125 MB per recorded hour (a depth sample is 34 285
  bytes at 1 Hz plus a GPS fix, `authoring-recording.ts.md`);
- session lengths from 15 minutes to 2 hours;
- what a saved copy is FOR: the zip was already handed over, so the copy
  only matters when the hand-off target lost it (a messenger share that
  failed, a download the owner cannot find) - noticed when the owner sits
  down to analyse, the same day to a few days later.

Storage the kept copies can hold (count x session length x 125 MB):

- 1 kept: 31 MB to 250 MB;
- 2 kept: 62 MB to 500 MB;
- 3 kept: 94 MB to 750 MB (chosen);
- 5 kept: 156 MB to 1.25 GB;
- 10 kept: 312 MB to 2.5 GB.

Weighed:

- **Count.** 1 deletes the morning session's copy when the afternoon's is
  saved, before either is analysed; 3 covers a field day of three sessions;
  5 or more can hold over a gigabyte in the origin the Recorder and the tile
  caches share, and the M1a opt-in warning already fires under 137 MiB free.
- **Age.** 1 day loses a Friday recording before Monday's analysis; 3 days
  misses a long weekend; 7 days covers a week and its weekend; 14 or 30 days
  keep copies nobody re-shares - for an author who records rarely, a single
  2-hour copy would sit there for a month.
- **What would reverse it:** sessions routinely over an hour (then 2 kept, a
  500 MB worst case); evidence that hand-offs never get lost (1 kept, 1 day);
  an owner who analyses weekly (14 days).
- **Why count and age, not bytes:** both come from the listing alone. A byte
  bound would read every action file's size (thousands per folder) at every
  page open.

The cleanup runs at page open only, on pages that show the recording's
controls (a creator's, or a visitor's with `?debug=1`).

## Examples

```ts
const dir = await openRecordingsDir(
  await navigator.storage.getDirectory(),
  false,
);
if (dir !== null) {
  const orphans = await tidyRecordings(
    dir,
    await heldRecordingFolders(navigator.locks),
    Date.now(),
  );
  // offer them; on "Save it":
  const packed = await packOrphanRecording(
    dir,
    orphans[0].name,
    env,
    AUTHORING_CONTEXT_TAG,
  );
  const outcome = await handOff(packed.blob, packed.filename);
  if (outcome.delivered) await packed.markSaved(Date.now());
}
```

## Tests

- `recording-folders.test.ts` (the framework's OPFS mock): which names are
  recordings; the marker across a killed tab, a save, and recording on after
  it; an action created after the zip read the folder, and an action file
  still empty at the count and the zip (both through a wrapped zip step;
  both fail if the count moves after the zip, the second also when it
  counts names); an unreadable marker; the listing's
  filter and order and the skip set; the cleanup bound's examples;
  `tidyRecordings` (deletes old saved and empty folders, keeps a held one,
  returns the unsaved, survives a refused delete); the lock round trip and its
  absence; the refused `session.json`; the orphan's rebuilt `session.json`
  (era 5, start, end from the files, coverage, tag from the log actions, an
  earlier save's tag, the fallback, a truncated last action, the empty file a
  killed write left dropped so the saved orphan is not offered again).
- `recording-folders.property.test.ts`: for any folders, bound and clock, the
  cleanup never deletes an unsaved folder with actions, what survives is
  within the bound, and nothing it could keep is deleted.
- `authoring-recording.test.ts`: the live save's `markSaved`, and recording on
  after it.
- End to end: `playwright-tests/ar-mode.spec.js` ("a recording whose tab was
  killed ...").
