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
- `recordingsToDelete(folders, nowMs, bounds?: CleanupBounds)` - pure: the
  names the cleanup deletes. `CleanupBounds { maxAgeMs, kept, minAgeMs,
emptyMinAgeMs }`, by default `SAVED_RECORDING_MAX_AGE_MS` (7 days),
  `SAVED_RECORDINGS_KEPT` (3), `SAVED_RECORDING_MIN_AGE_MS` (24 h) and
  `EMPTY_RECORDING_MIN_AGE_MS` (1 h).
- `tidyRecordings(dir, heldNow, nowMs)` - the page-open housekeeping: list,
  THEN ask `heldNow()` which folders a live page holds and leave those alone,
  delete what `recordingsToDelete` names (each counted again right before its
  delete; a changed count or a refused delete is skipped), return the unsaved
  recordings to offer.
- `deleteRecordingFolder(dir, name)` - recursive; rejects when OPFS refuses.
- `packRecordingFolder(folder, startedAt, writeMetadata, zip?)` ->
  `PackedRecording { blob, filename, actionCount, metadataError?, markSaved(atMs) }`.
  `zip` defaults to the framework's `exportSessionHandleAsZip`; the tests wrap
  it to write while the zip is built.
- `packOrphanRecording(dir, name, environment, fallbackTag)` - drop the
  folder's empty action files, rebuild its `session.json` from its own files,
  write it, pack.
- `recordedFixes(action)` - a recorded GPS action's fixes, in order: one for a
  `recordGpsEvent`, every event of a `recordGpsEventBatch` (core 1.26; the
  viewer's device fix with its keep-alive ring, read through the framework's
  `utils/gps-event-actions`), none for anything else; a fix without finite
  coordinates is skipped alone. The live save's and the orphan's coverage both
  count through it.
- `holdRecordingFolder(locks, name): Promise<boolean>` - take the folder's
  Web Lock for the page's life (`ifAvailable`: true once granted, false when
  another page holds the name, without Web Locks, or on a failed request).
- `heldRecordingFolders(locks)` - the folders whose lock a live page holds or
  waits for (`pending` counts).

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
  nothing to save, saved or not (M1b review #9), and is deleted by the cleanup
  once it is older than `EMPTY_RECORDING_MIN_AGE_MS` since its start: a
  folder is empty from its creation until its page writes the first action,
  so a young empty one may be a live page's (M1b review #2).
- **Only this app's folders.** Anything under `tour-viewer/` that is not a
  `recording-<UTC ts>[-N]` directory (a file, `drafts`, a malformed name) is
  neither listed nor deleted.
- **A live page's folder is untouchable.** The recording page holds a Web
  Lock named after its folder for its whole life (a request whose callback
  never settles); the browser releases it when the page goes - exactly "the
  tab was killed". The page-open housekeeping skips held folders, so a folder
  another open tab records into is neither offered nor cleaned up. Three
  rules close the gaps the M1b review (#2) found:
  - the page takes the lock BEFORE it creates the folder
    (`authoring-recording.ts`), so any folder a listing sees is already held
    if its page is alive; `ifAvailable`, so a name another tab holds is
    answered at once and the folder takes the next suffix;
  - `tidyRecordings` reads the held set AFTER the listing (read before, a
    tab that started in between would be offered), and a pending request
    counts as held;
  - each folder is counted again right before its delete, and one whose
    count changed since the listing is kept.
    Without Web Locks nothing is held or known held: the other tab's folder
    could then be offered, and deleting it would make that tab's writes fail
    visibly (its marker counts failed writes); the empty-folder age is the
    backstop there for a folder that has not written yet.
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

A saved copy goes `SAVED_RECORDING_MAX_AGE_MS` = 7 days after its save; before
that, the count keeps the `SAVED_RECORDINGS_KEPT` = 3 most recently saved, but
never deletes a copy younger than `SAVED_RECORDING_MIN_AGE_MS` = 24 h since its
save (M1b review #1). A folder with no action file goes once it is older than
`EMPTY_RECORDING_MIN_AGE_MS` = 1 h since its start. The parameters these rest
on:

- the measured rate, about 125 MB per recorded hour (a depth sample is 34 285
  bytes at 1 Hz plus a GPS fix, `authoring-recording.ts.md`);
- session lengths from 15 minutes to 2 hours, and a field day of 4 or more
  sessions (the case the count alone got wrong);
- what a saved copy is FOR: the zip was already handed over, so the copy
  only matters when the hand-off target lost it (a messenger share that
  failed, a download the owner cannot find) - noticed when the owner sits
  down to analyse, the same evening to a few days later. And "delivered" is
  optimistic: the framework's download fallback (`<a download>`) always
  reports a download started, and a share reports only that the file reached
  the app the author picked (`share-or-download.ts`). The page cannot learn
  more, so the copy's age is the only safeguard.

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
- **Maximum age.** 1 day loses a Friday recording before Monday's analysis; 3
  days misses a long weekend; 7 days covers a week and its weekend; 14 or 30
  days keep copies nobody re-shares - for an author who records rarely, a
  single 2-hour copy would sit there for a month.
- **Minimum age, weighed with the count.** The count alone deleted a field
  day's first copy as soon as the fourth was saved (the next page open), hours
  before the owner could have noticed a lost hand-off. The minimum age decides
  how long every copy is safe from the count; after it, the count applies.
  Over a field day of five 1-hour sessions saved at 9, 11, 13, 15 and 17 h
  (pinned in `recording-folders.test.ts`):
  - 0 (the old rule): session 1 goes at the page open after the 17 h save;
  - 6 h: session 1 goes at 15 h, before an evening look;
  - 12 h: session 1 goes at 21 h - a look that evening is a race;
  - 24 h (chosen): all five survive the evening and the next morning;
    sessions 1 and 2 go the following evening, when each is over 24 h old and
    three newer ones exist;
  - 48 h: a second day's grace, at the cost of two days of copies on
    back-to-back field days;
  - 72 h: three days of copies.
    Storage this adds: every copy saved in the last 24 h, beyond the 3 - five
    1-hour sessions are 625 MB, and two back-to-back field days can put up to
    ten sessions (1.25 GB at 1 hour each) inside one 24-hour window. The
    opt-in's low-storage warning is what surfaces that on a full phone.
- **Empty-folder age.** It guards the window from a folder's creation to its
  first action (the AR session request and its permission prompts: seconds to
  a minute or two; a declined entry leaves the folder empty while the page
  may still record on a later entry) on a browser without Web Locks, and the
  moment between the lock and the folder when another tab took the name.
  Weighed: 1 minute misses a slow permission prompt; 10 minutes covers the
  prompts but not a declined entry and a retry; 1 hour (chosen) covers both;
  1 day only keeps a few empty directories longer. Keeping an empty folder
  costs no bytes and deleting a live one costs its recording, so the value
  sits long.
- **What would reverse it:** sessions routinely over an hour (then 2 kept, a
  500 MB worst case); evidence that hand-offs never get lost (1 kept, 1 day,
  and no minimum age); an owner who analyses weekly (14 days); an owner who
  looks only a day or more after a field day (48 h minimum age); multi-day
  trips on phones short of storage (12 h minimum age, with the evening race
  above accepted).
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
    () => heldRecordingFolders(navigator.locks),
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
  `tidyRecordings` (deletes old saved and old empty folders, keeps a held
  one, reads the held set after the listing, keeps a folder that gained an
  action before its delete,
  returns the unsaved, survives a refused delete); the lock round trip and its
  absence; the refused `session.json`; the orphan's rebuilt `session.json`
  (era 5, start, end from the files, coverage, tag from the log actions, an
  earlier save's tag, the fallback, a truncated last action, the empty file a
  killed write left dropped so the saved orphan is not offered again).
- `recording-folders.property.test.ts`: for any folders, bounds and clock,
  the cleanup never deletes an unsaved folder with actions, deletes an empty
  folder exactly when it is past its minimum age, keeps no saved copy past
  the maximum age and at most `kept` past the minimum age, and deletes no
  saved copy it could keep.
- `authoring-recording.test.ts`: the live save's `markSaved`, and recording on
  after it.
- End to end: `playwright-tests/ar-mode.spec.js` ("a recording whose tab was
  killed ...").
