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
- **Open another tour** shows the dialog with Cancel (and Esc) back to
  the open tour; the open tour stays until the new file has opened, so a
  refused file costs nothing (E1 review #4).
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
  Undo toast for 8 s (the phone's hold) that a Save ends sooner, since
  the saved file no longer carries the object. Codes, stations and the
  walk's recorded photos stay read-only.
  A refused undo (the delete already written) says so in a toast
  rather than doing nothing. A delete or a move of a note the tour no longer carries
  (a card outliving its object) is refused in the session's words
  (`NOT_IN_TOUR`): the delete in a toast, with no "Deleted" toast and no
  Undo; the move on the card (PR #622 bot finding C).
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
- **Save** builds the tour (`keepScan` from the "Keep the walk recording"
  switch, shown only for a tour that carries a walk) and downloads it
  through the framework's `downloadZip` under `finishedFileName`; the
  status reads "N changes not saved" / "Saving…" / "Saved as <name>" /
  the error, with the Finish's result sentences (the walk left out,
  photos not placed) in the toast. Save is on whenever a tour is open
  and commits the card's typing first ("Nothing to save" when there is
  none - in the status line and, since plan 2026-10-15-0348 M0, in a toast:
  the status line already read "No changes", so the swap alone looked like
  nothing happened); a save belongs to its tour and ends quietly if another was
  opened meanwhile; the walk switch hides once a save is built (a later
  save rebuilds from it and could not bring the walk back). A dismissed
  save picker - the one undelivered case the page can see, since an
  `<a download>` always reports started - keeps the built file, and
  Save offers it again ("Not saved yet - tap Save again").
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
  - **Held** while a delete's Undo is live, the card's field holds typing not
    yet committed, a marker is being moved, a save runs, or the open dialog
    shows or an open is busy (`editing()`, `saving`, `!modal.hidden`,
    `busy`: an autosave landing in the middle of an open moved the NEW
    tour's draft, E2b-2 milestone review #1); the hold's end pokes it
    (`endUndo`, the field's commit, a move's end, an autosave's end, the
    dialog closing), and a hold that ends without a poke is looked at again
    once per delay (`autosave.ts`). An explicit save's end does not poke: its
    outcome reaches the autosave first, so a failed Save pauses it rather
    than starting a second write at once (milestone review #5). An autosave commits nothing and ends no undo;
    an edit begun while it checked the file (an await before the session's
    snapshot) gives it back as `held`, so a delete made in that moment
    keeps its Undo. A delete ends the earlier undo BEFORE it is made, for
    the same reason.
  - **Quiet:** the status line says "Saving…" and then "Saved to <name>",
    with no toast - except, once per tour, the photos a save could not
    place (`FINISH_LABELS.photosNotPlaced`), which an explicit Save's toast
    carries too: a creator who never presses Save hears it once (E2b-2
    milestone review #6); a refusal or a failed write shows the in-place refusal
    toast (one at a time: a new one replaces the last) and PAUSES autosave -
    the status adds "not saved by itself until you Save" - until an
    explicit Save or a download lands (no write loop).
  - **Ctrl+S during an autosave** commits the card and runs right after
    it; the Save button is disabled while any save runs, so only the key
    queues (E2b-2 milestone review #10). A queued Ctrl+S belongs to its tour:
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
  (`tourFileKeyOfFile`, worked out before the write, `landed`) - both
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
  stays until closed and covered its buttons). Opening another tour or
  losing this one closes it.
- **Titles:** the top bar and the tab say the tour's name (`model.title`,
  the file's name when it has none): `<name> - Tour editor`.
- **The open dialog's fine print** is `save-target.ts`'s
  `saveFinePrint(window)`: Save writes the chosen file where the file
  picker exists, else gives a new copy (W2: it said "a new copy" in every
  browser).
- **Leaving** with unsaved work asks first (`beforeunload`), and so does
  "Open another tour" (`window.confirm`).
- **Free area** for the card: right of the rail, under the top bar (read
  from the bar's own box), 12 px from the window's edges. The rail starts folded below 760 px.
- **Closing** a tour (another open) closes its session; the card revokes
  its photo's object URL.
- Builds a store first: the library's geo maths (the distance lines) runs
  only once one exists.

- Once everything is wired the page sets `body[data-editor="ready"]`;
  the keyboard e2e waits for it (a press before the module ran went
  nowhere - a flaky run under load).

## Tests

The modules it wires have their own unit tests; the page is pinned by
`playwright-tests/editor.spec.js` (the details dialog and the fine print
among them) and `editor-entry.spec.js` (the
"Nothing to save" toast, the open from a link); `way-in.spec.js` checks its first paint.
