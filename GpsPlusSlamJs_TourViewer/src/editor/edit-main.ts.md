# editor/edit-main.ts

## Purpose

The composition root of the desktop editor (`edit.html`, M6 E1): opens a
tour (chosen, dropped, or the sample), builds its model and wires the map,
the rail and the card in the chosen variant 1 layout, and edits it (E2a);
where the browser allows it, it saves the opened file in place (E2b-1,
`save-target.ts`); and it keeps every edit since the opened file in this
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
  `samples/marienplatz-tour.zip` beside the page. While a file is read the
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
  rather than doing nothing.
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
  and the edited notes (E2c plan review #9). Each save opens a session
  over the written copy, whose whole-archive check hashes a listed tour
  again in the background (E2b-1 review #9, for E2b-2's autosave to weigh).
- **Save** builds the tour (`keepScan` from the "Keep the walk recording"
  switch, shown only for a tour that carries a walk) and downloads it
  through the framework's `downloadZip` under `finishedFileName`; the
  status reads "N changes not saved" / "Saving…" / "Saved as <name>" /
  the error, with the Finish's result sentences (the walk left out,
  photos not placed) in the toast. Save is on whenever a tour is open
  and commits the card's typing first ("Nothing to save" when there is
  none); a save belongs to its tour and ends quietly if another was
  opened meanwhile; the walk switch hides once a save is built (a later
  save rebuilds from it and could not bring the walk back). A dismissed
  save picker - the one undelivered case the page can see, since an
  `<a download>` always reports started - keeps the built file, and
  Save offers it again ("Not saved yet - tap Save again").
- **The draft (M6 E2c).** Read inside the open, before the tour shows
  (`draft.open` over the session's file key). What an earlier visit left is
  offered in a toast that stays until answered (`.draft-offer`): Restore
  (`session.restore`, live edits winning; "N earlier changes are back - not
  saved yet"), Not now (offered again next time), Delete it
  (`draft.discard`; a failure is said). Records an edit elsewhere replaced
  are said once. Every edit goes to the draft through the session, whose
  writes are bound to its tour (`draft.writes()`: a closed tour's late
  write is dropped); a build
  adds its versions (`draft.built`), and an in-place write that landed
  clears what it wrote and moves the draft to the written bytes' key
  (`tourFileKeyOfFile`, worked out before the write, `draft.landed`). A tab
  that keeps no backup (no storage, a failed write, another tab holding the
  tour) says so once, after the tour shows; for another tab it says how to
  get a backup (close that tab, open the tour again here). `body[data-draft]` is
  `writing` / `saved` / `off`: the e2e waits for `saved` before it closes a
  page (`page.close()` skips `beforeunload`).
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
`playwright-tests/editor.spec.js`.
