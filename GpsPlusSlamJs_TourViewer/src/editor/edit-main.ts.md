# editor/edit-main.ts

## Purpose

The composition root of the desktop editor (`edit.html`, M6 E1): opens a
tour (chosen, dropped, or the sample), builds its model and wires the map,
the rail and the card in the chosen variant 1 layout, and edits it (E2a);
where the browser allows it, it saves the opened file in place (E2b-1,
`save-target.ts`) - by itself too, a few seconds after a change (E2b-2,
`autosave.ts`); and it keeps every edit since the opened file in this
browser, offered back by the next open (E2c, `editor-draft.ts`).

## Behaviour

- The open dialog's "Choose…" is a button, so the chooser can be reached
  and opened from the keyboard (the label and its hidden input are not in
  the tab order, PR #612 review).
- A text refused when committed by clicking away is said in a toast,
  since the card then shows something else (PR #611 review).
- Toasts last the Undo's 8 s, except the save's result, which says where
  to put the file and stays until it is closed.
- A file dropped anywhere on the page is held: only the open dialog's
  drop box opens it, so a stray drop never takes the open tour away (PR
  #609 review).

- **Open:** the file input's change and a drop on `#drop` call
  `openTourForEditing` (`editor-open.ts`); "Use the sample tour" fetches
  `samples/marienplatz-tour.zip` beside the page; `#link-form` fetches a
  hosted tour from its link (`editor-link.ts`, the viewer's transport and
  Drive proxy, tour editor plan 2026-10-17-1816 W1) and opens it as a
  chosen file - without a file handle, so Save downloads the new copy -
  saying "Fetching the tour from its link…" meanwhile and the refusal in
  `#open-error` (`linkOpenErrorText`). While a file is read the
  modal says "Opening <name>…" and its buttons are disabled; then the tour
  is drawn and a toast names what opened, or the reason shows in
  `#open-error` and the modal stays (root `CLAUDE.md`, async feedback).
- **The top bar's menus** (`menu-button.ts`): File (Open…, Save, Save a
  copy…, Tour details…, Add debug data…, the keep-the-walk checkbox,
  Share and publish…), Edit (Undo, Redo; the 3D view's, at a phone's
  width) and View (Top view, Frame, Show debug data, the view switch).
  Beside File the unsaved mark (`#unsaved-mark`): shown while the status
  is pending or an error, its `title` the status's words, which are in
  the bottom bar (`#shell-bar`, shown with the top bar in both views).
  Checkbox items keep their state in `aria-checked` (`isChecked`,
  `setChecked`).
- **The 3D view is the default:** an open that shows a tour ends with
  `viewSwitch.show3d()`; a 3D view that fails lands on the map, said in
  a line kept until closed. A tour with nothing positioned is no failure:
  it opens on the map with a passing line (`say`'s reason `"empty"`).
  In the dev server only, `window.__tourEditorStartOnMap` (an init
  script) keeps the open on the map, for the specs that edit there
  (`opensIn3d()`; stripped from a production build like the other dev
  hooks).
- **File > Open…** shows the dialog with Cancel (and Esc) back to
  the open tour; the open tour stays until the new file has opened, so a
  refused file costs nothing (E1 review #4). A tour of an older format is
  refused in `#open-error` (`olderFormatRefusal`), and the draft this
  browser kept for its file is deleted (`EditorDraft.forget`); once one
  was, and the box still shows that refusal, it adds that its unsaved
  changes cannot be restored (`playwright-tests/older-format.spec.js`).
- **Details the reader dropped** (a hand-edited description, contact or
  cover; M4a review #6) are said in a toast that stays until closed
  (`droppedDetailsLine`): which ones, and that the next save writes the
  tour without them; station descriptions and card images the reader
  left out (format minor 2: a picture gone, or a value a hand edit broke)
  in a toast of their own, naming each station by its rail name
  (`droppedStationFieldsLine`).
- **A failure latched during the open** (`integrityFailure()` right after
  it) refuses the tour (E1 review #6).
- **A late integrity failure** (`onIntegrityFailure`, the background
  whole-file check) closes the tour, hides it and shows
  `describeIntegrityError` in the modal.
- **Select:** a marker or a row selects; a row also brings its marker
  into view (`revealPadding`). A photo is read by `photoSource`: a placed
  one by `loadContentEntry`, a recorded one by `loadEntry`. The card follows the marker on every map move and on resize;
  Esc, the card's close and a click on the map clear the selection.
- **Editing (M6 E2a)** through `editor-session.ts`: a pin's text (committed
  on blur or Ctrl+Enter; an empty pin is refused in the phone's words),
  Move (the marker made draggable, Done applies the drop, Cancel or Esc
  puts it back; the card then says the height was kept), Delete with an
  Undo toast for 8 s (the phone's hold, which holds autosave too). Codes and stations
  stay read-only; the walk's debug camera captures are not items.
  The toast's Undo is the edit stack's (below): it runs while its delete
  is still the newest step (`editor.revision()` unchanged), also after a
  save wrote the delete, and a newer edit ends the toast. A delete or a move of a note the tour no longer carries
  (a card outliving its object) is refused in the session's words
  (`NOT_IN_TOUR`): the delete in a toast, with no "Deleted" toast and no
  Undo; the move on the card (PR #622 bot finding C).
- **Station pose lock:** the session gets `stationLocked` from the page's
  view state (`isStationLocked`), so every station opens locked and its
  move, turn and lift are refused (`STATION_LOCKED`) whichever control
  asked, until the inspector's lock beside Position unlocks it. The lock
  is per open tour and never saved; the radius, the name, a delete and a
  copy stay open while locked. The map's Move moves pins and photos only,
  never a station.
  A station made in this session - added by "+" or "New station here",
  split off by "Move to a new station", copied, or started by the station
  rule for an item moved out of every circle - starts UNLOCKED
  (`unlockMade`): it was placed nowhere on site yet, so placing it is the
  next thing its creator does. Undoing and redoing its add keeps it
  unlocked; the lock is still view state only.
- **In place (E2b-1).** "Choose…" and the drop box open the browser's
  file picker where it exists (else the file input), asking for write
  permission on that gesture. A granted file, held by this tab
  (`holdEditorLock`), is saved by writing it: the status reads "Saved to
  <name>". A tour opened to be written keeps its walk in EVERY save, from
  the open on - a download before "Edit here anyway" too, or that walk-less
  build would later be written over the original (E2b plan review #1,
  E2b-1 review #1) - and the walk switch is hidden. The file is checked before
  the build and again before the write; a changed, moved or unwritable file
  is refused in a toast that keeps the changes and offers "Download
  instead", which turns the tour's saves into downloads (still keeping the
  walk) - unless no save of the tour was built yet (delivered or not, PR #614
  review): the rebuild then reads
  the opened file, which no longer reads, so the toast says the edits
  cannot be saved here (E2b-1 review #4). A save checks against the target
  it started with, even if one was attached while it was built. A refused permission, a dropped or input-chosen file, and a second
  tab on a file of the same name (told, with "Edit here anyway") save as
  downloads. A second click while the picker is open opens nothing. The
  same file opened again in this tab waits for its old hold to let go.
  Ctrl+S / Cmd+S saves (matched by the key's letter, by its position only
  for a non-Latin layout), and the browser's own "Save page as" never opens
  on this page. Toasts about the file go when another tour is opened.
- After any save the card's photos read from the page's copy of what was
  written (a read-only session over it), never from the opened file, whose
  bytes may have been replaced (E2b plan review #2, #5). The page does not
  read the file back from disk: once something else rewrites it, a `File`
  read from it no longer reads. It is the editor session's own copy of the
  last build (`previous`) that lets "Download instead" still build; the
  photos' copy shares those bytes (the review's memory point declined).
  **Not covered:** a file changed on disk BEFORE the first save - even only
  touched, a new modified time with the same bytes, which Chromium's
  snapshot check on the opened `File` refuses - cannot be rebuilt: those
  edits cannot be saved, and the status says to open the file again; the
  desktop's draft (E2c) keeps them: the toast says this browser keeps a
  copy, offered back when the file is opened again - if the change on disk
  kept the tour's key (a tour built on a walk recording, or a listed tour)
  and the edited notes (E2c plan review #9); until it is reopened the
  status line says "N changes not saved - it cannot be saved here: open
  the file again" (E2b-2 milestone review #8). Each save opens a session
  over the written copy, whose whole-archive check hashes a listed tour
  again in the background (E2b-1 review #9); `photo-copy.ts` opens one
  copy at a time, so those checks never overlap: while one runs, the
  newest copy waits and replaces any copy waiting before it (E2b-2
  milestone review #3).
- **The debug layer** (`debug-capture-layer.ts`, M1 of the
  debug-captures plan): once the tour is on screen, the camera captures
  of `debugSource()` are placed (`debugCapturesOf`) and drawn as
  thumbnails, with "Reading the debug data..." and then how many it shows
  or why none (`#debug-status`). View's "Show debug data" (`#view-debug`,
  a checkbox item) shows only while there is a source and only on the
  map (`editor-shell.css`: the 3D view does not draw them yet), starts
  ticked and shows or hides them there: view state, never in the tour document, a
  save or the draft. Leaving the tour stops it.
  - The note card keeps clear of the panel (`debugPanelBox()`, passed to
    `card.place` as the box to avoid, r901 review #4): both share the
    window's lower right corner, and whichever lay on top covered the
    other's buttons. Pinned by the layout e2e "the note card never covers
    the debug panel, whichever note is open".
  - `debugSource()` is the one seam the layer reads (and a point cloud
    will): debug data added beside the tour wins - the creator chose it -
    else the opened file when it carries a walk (`tourWalk`, its
    pictures from the copy the page reads now), else none.
- **Add debug data…** (`addDebugData`, M2 step 5 of the debug-captures
  plan; the panel shows it for every open tour; its file input, or a file
  dropped on the panel): a debug bundle or a plain Recorder zip, opened
  as any zip is (`openTourFile`: the archive caps; the picture cap for
  its thumbnails) and read for whose it is (`readDebugBundle`, given the
  entries' declared sizes so an oversized identity is never read;
  `bundleMatchesTour` against `EditorSession.debugTour()`). Shown, also
  when it is another tour's (Q-C), with `addedDebugLine`
  (`added-debug-data.ts`) ahead of the layer's line; a file that is no
  debug data is refused in a toast (`notAddedLine`), the layer kept.
  The button reads "Adding the debug data…" and is disabled meanwhile,
  and is idle and enabled again however the add ends
  (`createAddDebugButton`). File's "Add debug data…" (`#file-debug-add`)
  is the same entry in both views (the map's panel is hidden over the 3D
  view): both open the one `#debug-add-input` and `createAddDebugButton`
  drives both.
  Never saved, never drafted, closed with the tour and forgotten at a
  reload (Q-H); a newer add replaces it; an add that ends after another
  tour opened is closed unseen.
- **Save** builds the tour (`keepScan` from File's "Keep the debug data
  in the tour file" checkbox item, shown only for a tour that carries a walk and
  unticked at the open (M2 of the debug-captures plan, E2: the walk is
  saved apart); a file opened for writing keeps its walk in every save,
  a download included - `keepsWalk`, the switch hidden) and downloads it
  through the framework's `downloadZip` under the session's `savedName()`
  (the page imports none of the Finish's rules; the debug data's file is
  named after it too, `debugBundleFileName`); the
  status reads "N changes not saved" / "Saving…" / "Saved as <name>" /
  the error, with the Finish's result sentences (the walk left out,
  photos not placed) in the toast (`savedToastWords`, `save-toast.ts`). A
  download that left the walk out puts the debug-data step FIRST and
  offers "Save the debug data" as the toast's action
  (`saveDebugFromToast`: the same `saveDebugData`, "Saving the debug
  data…" on its button meanwhile, the result in a toast): the save reads
  the opened file, so the copy must not be put in its place first (r901
  review #1). Save is on whenever a tour is open
  and commits the card's typing first ("Nothing to save" when there is
  none - in the status line and, since plan 2026-10-15-0348 M0, in a toast:
  the status line already read "No changes", so the swap alone looked like
  nothing happened); a save belongs to its tour and ends quietly if another was
  opened meanwhile; the walk switch hides once a save is built (a later
  save rebuilds from it and could not bring the walk back). A dismissed
  save picker - the one undelivered case the page can see, since an
  `<a download>` always reports started - keeps the built file, and
  Save offers it again ("Not saved yet - tap Save again").
- **The first Save of a tour without a file** (from a link, the sample,
  a drop or the file input) asks where to save it where the browser
  adopts the chosen file (`adoptsSavedFile`: both file dialogs, Android
  included since a check on a phone): `askSaveFile` opens the save dialog IN
  the click - File's Save's, Ctrl+S's and Share and publish's - before any await
  (Chromium refuses a dialog asked for after a long build; the walk's
  move's rule), and the pick rides through `runSave`, `saveTour` and
  `buildAndDeliver` to `deliver`. A picked file is written
  (`writeChosen`: the draft follows the written bytes as an in-place
  write's does), the status reads "Saved to <name>", and the file is
  ADOPTED (`adoptChosen`): `openedFile` and the top bar's file name
  become it and `attachTarget` makes it the save target, so later saves
  write it in place and autosave runs, exactly as for a file opened with
  "Choose…". A save that asked for a file is built as an in-place one
  (`keepScan` and `inPlace` both true whenever a pick rides along): the
  chosen file becomes the tour's own, so it keeps the walk (in place the
  walk always stays), and its write is the in-place save an undo crosses
  (D33, `stepCrossesInPlaceSave`), so an undo across it writes the file
  again. A pick the browser refused after all (`unavailable`) still
  downloads that build, walk included. Share and publish then says the changes are in
  "the file you chose when you first saved" (`DoneSaved.chosenAtSave`,
  set by the delivery into a chosen file and reset by every open), never
  "the file you opened". A chosen file that cannot be read back after its
  write (`adoptChosen`'s `getFile` fails) is not adopted: the tour is
  saved, a toast says the editor could not keep saving into that file and
  that the next Save asks again. A dismissed dialog keeps the built file
  for "Save again"; a refused dialog (no click, an iframe) downloads as
  before; a failed write says why and keeps the save. Not asked: a tour opened from a file
  the page may not write (a refused permission, another tab's name), which
  still downloads, and "Download instead" after an in-place refusal (no
  pick: a download). The fine print says which the browser does.
- **A tour opened from a link or the sample asks where to save it as it
  opens**, where the browser adopts a chosen file (`adoptsSavedFile`, the
  first Save's rule: both file dialogs, Android included):
  `askOpenSaveFile` opens the save dialog IN the sample's click or the
  link's submit, before the fetch, suggesting the name the fetched file
  will carry (`linkFileName`, the sample's own name; a Drive link without
  a `.zip` name gives `tour-<start of its file id>.zip`, so a second Drive
  tour does not offer the first one's file), dated to the second
  (`datedFileName`, local time: `<name>-YYYY-MM-DD-HHMMSS.zip`), so the
  same link or the sample reopened does not offer the file holding its
  edited tour, where Enter plus Replace would write the original over it. Asking
  before the fetch is kept on purpose: Chromium opens the dialog only
  within a few seconds of the click, and the fetch can take longer. The fetch runs
  meanwhile and the tour opens as before; only once it opened does
  `keepInChosenFile` take the pick: a picked file is written with the
  fetched bytes unchanged (the status line says "Saving into <name>…"
  while it writes, and the write holds the page's save slot as an
  `"open"` claim until the file is adopted, so Save is unavailable
  meanwhile, Ctrl+S is queued as behind an autosave and runs once the
  write ends, and Share and publish waits for it through `savesSettled`;
  the claim is taken with no await after the wait's last `saving()`
  check, a save started during the last await waited for first, and a
  claim stuck on an ended save stops the wait - `save-slot-wait.ts`'s
  `waitForSaveSlot`) and ADOPTED (`adoptChosen`, so saves go there in
  place and by themselves from the first edit), a toast says "Saved to
  <name>. Your changes are saved into it by themselves." - or only
  "Saved to <name>." when no in-place save got attached (another tab
  holds the name, the file cannot be saved in place: their own toasts
  say so) or the tour is too large to be saved after every change
  (`adoptChosen` / `attachTarget` resolve to whether it attached), and Share and
  publish names it as "the file you chose when you opened the tour"
  (`DoneSaved.chosenAtOpen`, reset by every open and by `dropTour`).
  Nothing is written into the picked file before the tour opened: a
  failed fetch, or a file the open refuses, writes nothing, and the
  picked file is released (`settleUnusedPick` over `save-target.ts`'s
  `releaseUnusedPick`): the browser made it, or emptied it if it existed,
  as it was picked, so it is never deleted (an empty file may be a tour
  the creator chose to replace), and a toast that stays says, beside the
  open's error that says what went wrong, that nothing of the tour was
  written into it and not to rely on it if it was an existing file (a
  toast, so a later change of the open's error cannot drop it). A
  dismissed dialog writes nothing and the tour
  stays in the browser's draft until Save, which asks again, suggesting
  the name dated to the second as the open's dialog did (`datedSave`, set
  by an open from a link or the sample, reset by every open); a write that
  fails says so in a toast that stays (`chosenFileUnwritten`, with what
  became of the file; it no longer says Save asks again, since Save asks
  only once there is a change) and leaves the tour the same way. A pick
  that lands after another tour opened, or after a Save already gave the
  tour a file, is not written (`stillToChoose`) and is released the same
  way, said in a toast that stays.
- **Where unsaved changes are, without a file saved into by itself:**
  while no in-place target exists (a browser without the save dialog, a
  dismissed dialog, a refused permission) and the draft backs
  the tour up (`draft.backsUp()`), the status line says "N changes not
  saved - kept in this browser until you save": on such a browser it is
  the one warning against losing work.
- **Storage kept (at the first open).** The page asks the browser once
  (`keepStorage`, the framework's `requestPersistentStorage`) to keep
  this site's storage - the drafts of unsaved work - from being cleared
  to make room; a refusal changes nothing and is not shown.
- **Autosave (M6 E2b-2, owner Q-E2-4).** While the tour is written in place
  (a target attached: `autosave.enable(true)`; off after "Download instead"
  and for every download-only tour), the page saves by itself
  `AUTOSAVE_DELAY_MS` (3 s) after the last committed change, at the latest
  `AUTOSAVE_MAX_WAIT_MS` (30 s) after the first unsaved one - unless the
  opened file is larger than `AUTOSAVE_MAX_BYTES` (200 MiB, a judgement,
  not a measurement: every save rebuilds and rewrites the whole file).
  Such a tour is saved when Save is pressed, and the status line says
  "large tour: saved when you press Save", adding "your changes are kept in
  this browser meanwhile" only when the draft backs up (E2b-2 milestone
  review #3).
  - **Held** while the card's field holds typing not
    yet committed, a marker is being moved, a save runs, or the open dialog
    shows or an open is busy (`editing()`, `saving`, `!modal.hidden`,
    `busy`: an autosave landing in the middle of an open moved the NEW
    tour's draft, E2b-2 milestone review #1); the hold's end pokes it
    (the field's commit, a move's end, an autosave's end, the
    dialog closing), and a hold that ends without a poke is looked at again
    once per delay (`autosave.ts`). An explicit save's end does not poke: its
    outcome reaches the autosave first, so a failed Save pauses it rather
    than starting a second write at once (milestone review #5). An autosave commits nothing;
    an edit begun while it checked the file (an await before the session's
    snapshot) gives it back as `held`. A delete's Undo toast holds it for
    its 8 s again (M4a review #2): W2 had dropped the hold, but a note an
    undo brings back after the save that wrote its delete is not offered by
    a later open's draft, so that undo did not survive a closed tab; the
    delete now reaches the file only once its Undo lapsed. Ctrl+Z still
    undoes it after that, in the live tab.
  - **Quiet:** the status line says "Saving…" and then "Saved to <name>",
    with no toast (it also said, once per tour, that the recorded photos
    could not be placed; nothing places them since the walk's camera
    captures are debug data); a refusal or a failed write shows the in-place refusal
    toast (one at a time: a new one replaces the last) and PAUSES autosave -
    the status adds "not saved by itself until you Save" - until an
    explicit Save or a download lands (no write loop).
  - **Ctrl+S during an autosave** commits the card and runs right after
    it, and so does Ctrl+S during the write at a link's or the sample's
    open (the `"open"` claim), during a copy being saved (`"copy"`) and
    during a move of the debug data (`"walk"`): every claim but an
    explicit Save itself queues it, and the claim's end runs it
    (`runQueuedSave`); the Save button is disabled while any save
    runs, so only the key queues (E2b-2 milestone review #10). A queued
    Ctrl+S on a tour with no file to save into (no target, no opened
    handle) in a browser that asks where to save does not run - the
    browser allows that question only within the key press - but says
    "Press Save to choose where to save the tour." instead of downloading.
    The open's write and a copy let the slot go by their own claim
    (`saveEnd` still theirs), also when another tour opened meanwhile, so
    a claim never outlives its write. A queued Ctrl+S belongs to its tour:
    a save whose tour closed meanwhile drops it (`abandon`, milestone review
    #7). A restored draft's work is saved by itself like any edit.
  - `body[data-autosave]` is the scheduler's state (`off`, `idle`,
    `waiting`, `held`, `saving`, `paused`), the e2e's readiness mark. In
    the dev server only, `window.__tourEditorAutosave` (an init script) sets
    the delays and the size cap (`maxBytes`), so a walk that times its own in-place saves can move
    autosave out of its way; a production build strips the read
    (`import.meta.env.DEV`).
  - Each autosave is an in-place write like Save's: the tour's
    `writes().built` and `writes().landed` run as for Save (an edit made while it ran stays in the
    draft, carried along when a tour of notes alone moves its key), and each
    opens a session over the written copy (a listed tour is hashed again in
    the background, E2b-1 review #9) - the delay and the max wait bound how
    often.
- **The draft (M6 E2c).** Read inside the open, before the tour shows
  (`draft.open` over the session's file key). What an earlier visit left is
  offered in a toast that stays until answered (`.draft-offer`): Restore
  (`session.restore`, live edits winning; `editor-draft.ts` `restoredLine`:
  "N earlier changes are back - not saved yet", or why nothing came back in
  the offer's own terms - notes, the setting, or both, M1b-2 milestone
  review #6), Not now (offered again next time), Delete it
  (`draft.discard`; a failure is said). Records an edit elsewhere replaced
  are said once. Every edit goes to the draft through the session, whose
  writes are bound to its tour (`draft.writes()`: a closed tour's late
  write is dropped); a build
  adds its versions (`built`), and an in-place write that landed
  clears what it wrote and moves the draft to the written bytes' key
  (`tourFileKeyOfFile`, worked out before the write, `landed`), and a
  download that arrived whose bytes have another key (the first save of a
  tour without an id, Q-I) takes the draft there (`moved`, the old
  namespace kept) - all
  through the tour's own `draft.writes()`, taken when the save started, so
  a save of a closed tour moves nothing of the next (E2b-2 milestone
  review #1). A tab
  that keeps no backup (no storage, a failed write, another tab holding the
  tour) says so once, after the tour shows; for another tab it says how to
  get a backup (close that tab, open the tour again here). `body[data-draft]` is
  `writing` / `saved` / `off`: the e2e waits for `saved` before it closes a
  page (`page.close()` skips `beforeunload`).
- **"This tour needs no GPS" (QR-first M1b-2, owner Q-QF-1).** A checkbox
  at the top of the rail (`#no-gps-input`, hidden with the folded rail):
  turning it on or off is an edit (`session.setNeedsNoGps`) - pending in the
  status line, backed up by the draft, saved by Save and by autosave like
  any change. A tour opened with `needsNoGps` shows it on. While it is on,
  `#no-gps-warnings` (a polite status region, never blocking the save)
  carries `no-gps-check.ts`'s lines: the stations without a printed code,
  and the stations on a code the viewer cannot use (no printed size, or not
  in the tour), by name and count - or, when no code can place the tour,
  that visitors are asked for their location anyway. Redrawn on every
  `refresh()` (a restore, a save) and on each toggle, through
  `status-lines.ts`: the lines are replaced only when their words change,
  and the region is never `hidden` (an empty one is zero-height), so a
  screen reader announces the first lines and never the same ones again
  (M1b-2 milestone review #5).
- **Tour details (W2 of the tour editor plan 2026-10-17-1816).** The
  tour's name in the top bar (`#tour-name`, a button) opens the details
  dialog (`details-dialog.ts`, `#details-modal`): name, description, cover
  and contact. The cover picker is drawn here: "None" and the session's
  `coverChoices()` as radios, each with its picture read from the zip as
  an object URL (released when the dialog closes). Apply goes through
  `session.setDetails`; a change refreshes, says "Tour details changed -
  not saved yet." and tells autosave (an edit like any other); no change
  says so too; a refusal stays in the dialog. Esc closes it; focus goes
  back to the name. The dialog sits above the toasts (a save's result toast
  stays until closed and covered its buttons). While it shows, the rest of
  the page is `inert` (`page-inert.ts`, M4a review #12): Tab stays in the
  dialog. Opening another tour or losing this one closes it.
- **Save a copy…** (File): the tour as it is now, written to a new file
  while the tour's own file and its unsaved state stay as they were
  (`EditorSession.saveCopy`, named by `copyFileName`, "<name> copy.zip").
  The file is asked for IN the click (`pickSaveFile`), the copy holds the
  save slot as a `"copy"` (which leaves a due resave and the last save
  error as they were), a pick of the opened file or of the save target is
  refused before anything is written, and the copy keeps the walk only
  when the keep-the-walk item is ticked. While it runs the status says
  "Saving a copy…" and keeps the unsaved mark for what the tour's own
  file still lacks; once it ends, a resave that fell due runs
  (`resaveIfDue`). It is written into the picked file, or downloaded
  where there is no save dialog; a toast says where ("Saved a copy as
  <name>…"), or why it was not saved.
- **The File menu's items** follow the open tour and the save slot
  (`renderFileItems`): Save and Save a copy off while no tour is open or a
  save runs, Tour details off without a tour, Share and publish off
  without a tour or while the walk moves out. They are disabled the menu
  pattern's way (`setItemDisabled`, `aria-disabled`: reachable, a click
  ignored); the debug data add and the view switch drive their item
  through `menuItemControl`.
- **Share and publish… (W2, D18, D19; once "Done").** File's
  `#file-publish` commits the card, waits for a running save and saves
  what is pending ("Saving…" on the item, disabled, while it runs - the
  async-UI rule); a save that did not land keeps the dialog shut and says
  so in a toast ("Not ready to share yet: ..."). Then `done-dialog.ts` opens with the facts: where the last
  save arrived (`delivered`: in place under the target's name, or
  downloaded; "unchanged" when nothing was saved), the host (the link's the
  tour was fetched from - "own" for a link to no cloud host - else the
  setup's stored choice, else Google Drive; a picker of `TOUR_HOSTS`),
  for a tour from a link the name its file has there (`linkHostedName`;
  null for a link that names no zip, such as a Drive file id), else, for a
  save under a dated name (also reopened, or restored from a draft), that
  name without its date (`undatedFileName`), so the update steps say to
  rename the saved, dated file to it before uploading it over that file
  (the draft keeps no hosted name of its own), whether the newest bytes carry the
  walk (`walkEntries()`; a check that fails is `unknown`, said as "may
  carry", never as "carries none" - the M4b milestone review #9), and the
  Drive-mount tip's switch (`DRIVE_MOUNT_TIP_SHOWN`, off). The rest of the
  page is `inert` while it shows; Esc and Close close it - but not while a
  move runs - and focus goes back to the File menu's button. It waits for saves with
  `savesSettled()`, which can never spin: a claim still set on an ended
  `saveEnd` stops the wait.
- **Save the debug data** (`saveDebugData`, M2 of the debug-captures
  plan): offered by Share and publish after a save as a new file left the walk out
  (`debugLeftOut`: the opened file carried a walk - `openedWalk`, cleared
  by a move that landed and at a close -, it is not opened for writing,
  and the newest bytes carry none). The file is asked for IN the click
  (`pickSaveFile`), the bundle built from the opened file
  (`EditorSession.debugData`) and written there, or downloaded where
  there is no save dialog. It holds no save: nothing of the tour changes.
  The opened tour file itself chosen as its target is refused before
  anything is written (`isSameFile` against `openedFile`, the name and the
  handle it was picked through; r901 review #5): the bundle would land
  over the file it is read from. The file a first Save adopted is refused
  the same way (`target.isSame`): it is the tour's file then.
  The opened file is read when the save runs, not when the tour opened:
  the page keeps a reference to it (a `File`), valid only while the file
  on disk is unchanged, so a copy put in its place first leaves nothing
  to read (`EditorSession.debugData`).
- **Move the debug data out (D19)** (`moveWalk`; the walk written as the
  debug bundle, `debug-bundle.ts`, since M2 of the debug-captures plan,
  and the dialog's and the refusals' words name it as debug data): each
  step holds the page's
  one save slot (`claimSave("walk")`, which a save takes too, as
  `"explicit"` or `"auto"`: the save status names the holder and a new
  `saveEnd` is made for Share and publish to wait on; `walkMoving()` - the
  holder is the walk - keeps it disabled), and
  the dialog cannot be closed meanwhile (the M4b milestone review #1).
  **The walk's file is asked for IN the click** (`pickSaveFile`, before
  any await: Chromium opens its save dialog only within a few seconds of a
  click, and the build takes longer - review #2). Then it checks the
  in-place file is unchanged, builds the move (`moveWalkOut`), and:
  - the opened tour file itself chosen for the walk: refused before
    anything is written (`SaveTarget.isSame`; the M4b fix re-review #1 -
    the walk's zip over the tour left the tour nowhere);
  - with a chosen file: writes the walk's zip into it
    (`writeFileOrAbort`), then the tour - in place; a tour with no file
    to write into (a sample, a link, a file it may not write) returns
    `walk-saved`, and its download waits for a second click (re-review
    #2: after the walk's write the click's window has passed);
  - a refusal after the dialog gave a file says nothing was written into
    it and to delete it if the dialog created it empty (re-review #5);
  - dismissed: nothing moved;
  - without a save dialog (or one the browser refused): downloads the
    walk and returns `downloaded` - the tour is rewritten only on a
    SECOND click ("Take the debug data out of the tour"), since a started
    download is not one that landed;
  - the tour (`deliver` with `offerDownload: false`, in place or
    downloaded) is written only while the move is `current()` (no save
    landed between the clicks), and the move is committed only once both
    landed - so a failed write of either leaves the tour file, and the
    session's next save, carrying the walk. A failed tour write offers no
    "Download instead" (review #6): the refusal is said in the dialog.
    `deliver` counts a write that landed as arrived, whatever follows it
    (the photos' copy; re-review #4).
    The outcome carries where the changes are now (`doneSaved()`), so the
    dialog's first line and steps follow (review #10).
- **Undo and redo (W2 of the tour editor plan 2026-10-17-1816).** Ctrl+Z
  undoes, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on a Mac; by the key's letter,
  as Ctrl+S): one step of the session's edit stack (`editor.undo()` /
  `redo()`), over every edit kind - a text, a move, a delete, the "needs
  no GPS" setting, the details, a restore. `runStep` cancels a move,
  commits the card, ends the delete toast, takes the step and says it in a
  toast ("Undone: the delete of "Fountain".", "Nothing to undo.", or the
  session's refusal while a save runs); a step is an edit, so it tells
  autosave. In a field (the card's text, a dialog's input, the search) and
  while a dialog shows, the keys are left to the browser: the field's own
  undo. A photo brought back after a save wrote its delete is drawn from
  the picture the session kept (`pictureOf`).
  - **A step across an in-place save writes the file again once the steps
    pause (D33, owner decision of the tour editor plan §32).** The open
    drops every draft record of an id the file on disk lacks, so a delete
    saved in place, then undone and the page reloaded before the next save,
    lost the note. `resaveIfDue` runs `RESAVE_QUIET_MS` after the last step
    (every step restarts the timer), at each save's end, and when the open
    dialog closes; it waits - the resave staying due - while the quiet time
    runs, while a save runs, while an edit is being made (`editing()`: the
    delete's Undo offer, a card field not yet committed, a move; their end
    asks again - the Undo offer's end, the card's commit, a finished or
    cancelled move), and while another tour is being chosen or opened
    (`busy`, the open dialog showing). Started during an edit, a resave
    would be claimed - which takes it on - and then held as an autosave
    is, and nothing would write the file until Save. One small window
    remains (filed as a follow-up): a resave already claimed, and still
    checking the file, when an edit starts is held the same way, and since
    its claim took the resave on, nothing raises it again until Save. A
    step restarts the
    quiet time before it ends the Undo offer, so that end finds the timer
    running. When
    the slice says a resave is due (`save.resave`; the rule, "crosses", is
    `tour-document.ts.md`'s "A step across an in-place save") and the tour
    is written in place (`target`), it saves through `saveTour("auto")` -
    quiet like an autosave: "Saving…" in the status line (Save disabled),
    then "Saved to <name>". Its outcome tells autosave as an explicit
    Save's does (a landed one ends a pause, a failed one pauses it).
    - **A failure** is said after the undo's own toast, through the
      existing channels: the in-place refusal toast (the file changed or
      moved, the permission lapsed, the write failed - with "Download
      instead") or the status line's "Not saved: ..." for a build that
      failed; the status line leaves "Saving…" and counts the change as
      not saved.
    - **Coalesced** (the r888 review's SHOULD-FIX 1, the coordinator's
      decision): autosave writes about 3 s after each change, so nearly
      every undo starts at the file and crosses it. Written at once, a run
      of five undos was five rebuilds and five whole-file writes, and each
      undo that came while one rebuilt was refused. Now a run of steps is
      one write of where it ended.
      - **The quiet time is 700 ms**, a judgement for steps at a person's
        pace (a few hundred ms apart), not a measurement.
        - Shorter (towards 0) brings the refusals back for a slower hand:
          a step that comes once a resave has started is refused while it
          rebuilds.
        - Longer widens the window in which the disk still lacks the
          restored note. The draft does NOT cover that window: the open
          drops a record of an id the file lacks, which is the loss D33
          fixes. A reload in it asks first (`beforeunload`: the change is
          pending), so only a crash or a forced close loses it.
    - **A second undo** after the resave started is refused while it
      rebuilds, as during any save: the toast "A save is running - undo or
      redo once it has finished." (the delete toast stays). Once the
      rebuild ended (the file being written), a step is taken; when it
      crosses again, it is written when that save ends - so resaves never
      overlap a write, and the last step's view is what the disk keeps.
    - **Not for a download**: a tour opened from the file input, a link or
      the sample, a file the browser may not write, or one whose saves
      "Download instead" turned into downloads. `target` is null, the
      slice's `inPlaceAt` is null after a download, and a download cannot
      be rewritten silently. The earlier in-place file then stays as it was
      written.
    - **Also for a large tour** (autosave off): one full write per run of
      steps that crosses - the cost of the disk matching the editor.
    - **Held**: a resave that finds an edit begun (typing, a move) gives
      itself back as an autosave would; the autosave writes it once the
      hold ends (a large tour's waits for Save).
- **Titles:** the top bar and the tab say the tour's name (`model.title`,
  the file's name when it has none): `<name> - Tour editor`.
- **The open dialog's fine print** is `save-target.ts`'s
  `saveFinePrint(window)`: Save writes the chosen file where
  the file picker exists, a tour from a link asks for its file as it
  opens (or at its first Save) where the browser adopts it, else gives a
  new copy
  (W2: it said "a new copy" in every browser).
- **Leaving** with unsaved work asks first (`beforeunload`), and so does
  File's Open… (`window.confirm`).
- **Free area** for the card: right of the rail, under the top bar and
  above the bottom bar (read from the bars' own boxes), 12 px from the
  window's edges. The rail starts folded below 760 px.
- **Closing** a tour (another open) closes its session; the card revokes
  its photo's object URL.
- **The page's store** (`createTourViewerStore()`, built first: the
  library's geo maths - the distance lines - runs only once one exists)
  holds the tour document (`../tour-document.ts`, D29-D31): the session
  is created on it (`createEditorSession({ store })`), and the page's save
  workflow state is its `save` status, not module variables - who holds
  the one save slot (`saveClaimed` / `saveReleased`; `saving()`,
  `walkMoving()`, the autosave's `by === "auto"`), a Save queued behind
  any other claim (`saveQueued`), a save built (`saveBuilt`), where the last
  one arrived (`saveDelivered`, read by Share and publish and by the status line's
  "Saved to …" / "Saved as …", `savedLine()`; `#save-status[data-saved]`
  is only a view of it, for the e2e, never read back; every write of the
  line goes through `showSaveStatus`, which sets its state, its words and
  its `title` together, so a line the 3D view's bar cuts short still
  shows whole on hover), the save's own
  rebuilds (the session's thunks, `../tour-document-save.ts`), and what the opened file
  allows (`saveLimited`: `largeTour`, `cannotSave`). An open resets them
  (`opened`), and so does a tour dropped for a late integrity failure
  (`closed`); the slot itself is kept across both, since the save holding
  it lets it go once it sees its tour gone. What stays in this module is
  imperative: DOM nodes, the file target and its lock, the draft handle,
  timers and toasts, and the built file a browser did not deliver
  (`undelivered`, a Blob; the store holds only that one waits).
- **The page's chrome state is the store's too** (`editorView`,
  `editor-view.ts`, mounted only here: `createTourViewerStore(undefined,
{ editorView })`): the selection, `busy`, the marker being dragged and
  its drop, `keepsWalk`, `openedWalk`, `doneBusy`, whether a save waits
  to be delivered, the card's outcome line and the file picker's
  `picking`. The page reads them through `ui()` and changes them only by
  `editorViewActions` (`say(message)` for the card's line,
  `setUndelivered(save)` for the waiting save), so another view of the
  page reads the same copy. Kept here on purpose: `moved` (the notes
  moved since the last save, a `Set` only the card reads) and everything
  imperative above.
- **The 3D view** (View's `#view-switch`, `view-switch.ts`): the item
  opens the 3D view over the map by a dynamic `import()` of
  `../editor3d/editor3d-scene.js`, so the page's own code holds none of
  it, and closes it again. While it loads the item and the bottom bar's
  `#view-loading` say so and the map stays; once it shows, `#view3d` is unhidden and the card hides (it
  points at a map marker); back on the map the card shows again for the
  same selection. A failure (its code, no WebGL, nothing placed, a lost
  context, an error) lands on the map with a toast saying why; an import
  that does not arrive is tagged `chunk` here, so only it speaks of the
  connection. The failure's toast stays until closed, or until a later
  open shows the view. Opening another tour
  or closing this one closes the 3D view (`viewSwitch.close()`); the
  switch is off while no tour is open. The 3D
  view reads the tour from the store and the codes the open read
  (`openedLevels`), and edits through the page's `edits`:
  - `commit` (`commitSceneEdit`) writes a finished gesture as one undo
    step (`applySceneEdit` of `scene-edits.ts`): it ends a delete's Undo
    offer, refreshes the views and tells autosave, or toasts a refusal;
    an item pose that gave the item another station is said in a toast
    (`announceReseat`, `reseat-note.ts`), and a station the rule made
    for it starts unlocked. The 2D map's drag (`finishMove`) says the
    same on the card ("... - not saved yet.");
  - `remove` (`deleteSelection`, the card's Delete too) deletes an item
    with the toast's Undo, or a station (`deleteStation`);
  - `duplicate` (`duplicateSelection`, Ctrl+D) copies an item or a
    station beside itself, selects the copy and says "Duplicated ...";
  - `groundMenu` hands a right click's (a long press's) ground menu to the
    shell (`shell.groundMenu`);
  - `keysFree` is false in a field, in a menu, or for the pattern's keys on a menu's button
    (`key-target.ts`: the menu's arrows, Home and End must not nudge the
    selection behind it), while a dialog or the modal shows and while the
    page is busy, so the 3D view's keys leave those alone.
    A gesture under way counts as an edit being made (`editing()`, the
    `gesture` field of the view slice), and an undo or a redo cancels it
    first (`runStep`).
- **The tree's station commands** (G2 M3b), given to the shell as
  `stations` with a `say` (a toast), each one undo step that ends a
  delete's Undo offer, refreshes the views and tells autosave:
  - `add` (`addStationAt`) - a station at the view's centre ("+") or
    where the ground menu was opened: selected, its card unfolded, said
    (`Added "Station 4" at the centre of the view` / `... here`); a
    refusal is said;
  - `reorder` (`reorderStations`) - the stations in a new order (the
    tree's drag, the inspector's Earlier and Later);
  - `split` (`splitItem`) - "Move to a new station"
    (`editor.moveToNewStation`): the new station selected, unfolded and
    said (`New station "..." with the pin in it`);
  - `duplicate` and `remove` - `duplicateSelection` and
    `deleteSelection`, as the 3D view's Ctrl+D and Del.
- **The inspector's edits**, given to the shell as `edits`, each one
  undo step that ends a delete's Undo offer, refreshes the views and
  tells autosave unless nothing changed; a refusal is said
  (`writeInspectorEdit`):
  - `station`, `text` and `block` - `editor.editStation` (name, description,
    radius, card picture), `editor.editText` (a pin's text) and `editor.editBlockField` (a block's other text fields, B2c);
  - `scene` - `commitSceneEdit`, as a gesture's (a typed place, a size,
    a station put on the ground);
  - `groundItems` - `editor.groundItems`, items' heights in one step
    (the ground under each, or a typed Height: their places untouched);
  - `addPin` (`addPinTo`) - a new pin in the station (`new-pin.ts`:
    clear of its items, inside its circle, on the ground the 3D view
    has loaded), placed by `editor.place`, selected and said (`Added a
pin to "..."`).
- **The 3D view's studio shell** (`editor-shell/editor-shell.ts`): made
  once at start; the switch's `onShown` sets `body[data-view]` (`3d` or
  `2d`, which the shell's stylesheet follows), makes the map `inert`
  while the 3D view shows (out of the Tab order under it), and shows the
  shell over the shown view or hides it. Its selection is the page's `select` (so
  the map's markers follow), Undo and Redo (the bar's and Edit's) are
  `runStep`, Details is
  `openDetails` (the tour's name opens the same dialog), its pictures
  and the scene's content are read through `readContent` (the copy the
  page reads now), and its codes come from `shellCodes` (the model's
  codes with their stored position and print size as opened).
- **The dev server's test hook** `window.__tourEditor` (`{ editor(),
edited(), view3d(), view3dTilt(deg), view3dDistance(m),
view3dPointOf(selection), view3dScreenOf(selection), view3dHandle(part),
view3dGizmoSizes(), manifest(), selected() }`): an e2e reaches the editor session's edits no control of
  this page offers yet, then `edited()` follows them as an edit made here
  would (refresh, autosave told); `view3d()` is the shown 3D view's
  `stats()` (null on the map), `view3dTilt(deg)` tilts its orbit and
  `view3dDistance(m)` moves it in or out, `view3dPointOf(selection)` says
  where a selection stands in its world; `view3dScreenOf`, `view3dHandle`
  and `view3dGizmoSizes` say where a selection and the gizmo's handles are
  on the canvas and how large; `manifest()` is what a save would write
  now and `selected()` the selection. Guarded by `import.meta.env.DEV &&
!import.meta.env.VITEST`, so a production build strips it.

- Once everything is wired the page sets `body[data-editor="ready"]`;
  the keyboard e2e waits for it (a press before the module ran went
  nowhere - a flaky run under load).

## Tests

The modules it wires have their own unit tests; the page is pinned by
`playwright-tests/editor.spec.js` (the details dialog, the fine print,
the undo keys, a delete's Undo after its autosave - written again at once,
since that undo crosses the in-place save - an undo across an in-place save
written at once ("Saving…" while it writes, then a reload keeping the note),
its failed write said after the undo, an undo of an edit made after the save
writing nothing once the quiet time passed, three undos at a person's pace
making one write with no refusal, an undo while a write runs written at that
save's end, a large tour's undo written, no download by itself after
"Download instead", and a resave waiting while another tour is being chosen
(D33), and Share and publish with the
walk's move - the save dialog asked for on the click and the walk in the
chosen file, the dialog held open and its item disabled while it runs, the
download's second click, the tour file itself refused as the walk's, a
tour with no file downloaded on a second click, a dismissed walk save and
a failed tour write
each followed by a save that still carries the walk - among them; the
debug layer and "Add debug data…": an added file's captures and line,
another tour's and a plain recording's lines, a refusal, no save carrying
it, a reload forgetting it, a drop on the panel shown in place of the
tour's walk) and `editor-entry.spec.js` (the
"Nothing to save" toast, the open from a link); `way-in.spec.js` checks its first paint.

`editor.spec.js` also renames a station through the test hook, closes the
tab, and sees the draft offer the change and Restore bring it back (seen
red with the settings record's stations left out). The chrome state's
slice: `editor-view.test.ts`. The 3D view as the default, its switch, its
loading and failure states and the selection kept: `editor3d.spec.js`; the studio
shell's layout, its fold steps, the menus by keyboard and touch and the
unsaved mark, and its tree clicks: `editor3d-shell.spec.js`; Save a copy
and the menus inside the window: `editor.spec.js`; editing in
the 3D view (a drag saved and undone, every key, Ctrl+D and Del, a second
finger's cancel): `editor3d-edit.spec.js`.

The first Save of a tour without a file (`editor.spec.js`, all with the
click-bound stand-in save dialog, which a call outside the gesture finds
refused): adopted and then saved by itself; the walk kept in the chosen
file and Share and publish naming it as the walk's; an undo across that first save
writing the file again; a dismissed dialog keeping the save (the stand-in
dismisses only inside the click, so a dialog asked for after the build
would download and fail it); Ctrl+S and Share and publish each asking
inside their own gesture, its line naming "the file you chose when you first saved";
and a chosen file that cannot be read back saying so, the next Save
asking again. A tour opened from its link or the sample (`editor.spec.js`):
asked for in the click under the link's file name, "Saving into" while
the held write runs, then the toast, the file holding the tour and the
first edit saved into it by itself, the written file's size and SHA-256
the link's own, and Share and publish's line; a link that fails after a
pick writing nothing, the file kept and the sentence said in a toast that
outlasts the usual toast time, and an existing
(seeded) file picked neither written nor deleted; a write refused at the open (a
lasting toast, the status line back, the name the open's, the file
kept, the first Save of a change asking again); the save slot held
while the write at the open runs, Save unavailable then and a Ctrl+S
pressed then saving the edit made meanwhile once the write landed (the
page's clock paused, so no autosave could); a file another tab is
editing not said to save by itself; a dismissed dialog
leaving the tour in the browser (the status line says so) and the first
Save asking again, under the dated name; a Ctrl+S pressed while a copy
is being saved saving the tour once the copy is done; and on Android (its client hints) the same dialog as
on a desktop.
