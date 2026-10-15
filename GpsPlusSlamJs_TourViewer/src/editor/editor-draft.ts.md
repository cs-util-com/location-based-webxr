# editor/editor-draft.ts

## Purpose

The desktop editor's draft (M6 E2c): every edit since the opened file,
kept in this browser so a closed tab, a crash or a file that no longer
reads does not lose it, and offered back by the next open of the same
tour. The phone's records and rules (`draft-persistence.ts`,
`authoring-draft.ts`) and its per-id queue (`keyed-chain.ts`), under the
editor's own namespace, one tab at a time. Design:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`
§9, "E2c" and "Cold review of the E2c plan" (its twelve verdicts).

## Public API

- `createEditorDraft({ openStore, holdLock, noBackup, onWriting? }): EditorDraft`
  - `openStore(key)` - a draft namespace's store (`draft-store-root.ts`),
    undefined without persistence; `holdLock(key)` - this tab's hold on the
    draft key (`holdEditorDraftLock`); `noBackup(reason)` - said once per
    opened tour (`"storage"`: no storage or a write that did not land;
    `"other-tab"`: another tab holds the draft); `onWriting(true|false)` -
    writes started / all settled (the page's `data-draft` mark).
- `EditorDraft` - the four `DraftObjectWrites` (`draft-actions.ts`), plus:
  - `saveSettings(settings)` (QR-first M1b-2) - the tour's settings
    (`EditorTourSettings`, today `{ needsNoGps }`) as they stand now: the
    `settings` record is written while it differs from the file on disk
    (or from a build's value), removed once it does not; whether it landed.
  - `writes(): EditorTourDraft` - those five, and `built` and `landed`
    below, bound to the tour open NOW, which the page gives the editor
    session and its saves: once another tour opens they are dropped
    (resolve without writing), so a late write of the old editor never
    lands in the new tour's namespace with the new tour's `seen` (milestone
    review #6), and a save of the old tour that lands while the next one
    opens moves nothing of the new tour's draft (E2b-2 milestone review #1).
  - `open(fileKey, manifest)` - closes the last tour's hold, holds
    `editor:<fileKey>`, reads it, clears what the file carries, and
    resolves `{ offer, superseded, backedUp }`: `offer` (`objects`,
    `deleted`, `settings?` - the record when the file does not carry it,
    `text` from `restoreOfferText`, changes and deletions named apart, a
    changed setting counted as a change and NAMED with its value - "It is
    "This tour needs no GPS" turned on." alone, "One of the changes is
    ..." beside notes, M1b-2 milestone review #3) or null; `superseded` -
    `supersededLine(n, "in this browser")` or null. Awaited before the
    tour shows.
  - `restored()` - the session applied the offer (its writes rewrote what
    it applied).
  - `discard()` - "Delete it": the offer's ids, minus those written since
    the open, rejected in the meta (the commit point), then the offered
    settings record removed (awaited, unless the setting was changed since
    the open) and the ids' files removed; false when the meta write or the
    settings removal did not land - the meta is put back and the offer
    re-armed, so a key move before the next open still carries it (M1b-2
    milestone review #4).
  - `writes().built(written)` - a save was built: each pending record's version in
    the written manifest (as a reader parses it, `manifestAsRead`) joins its
    base's `written` list; the setting's keep is decided again against the
    build's value.
  - `writes().landed(written, fileKey)` - an in-place write landed: pending changes
    the file now carries clear, the file's versions become the `seen`
    source, the setting's keep is decided again; when `fileKey` is another
    key, the draft moves to it synchronously.
  - `backsUp()`, `close()`, `idle()`.
- `restoredLine(count, offer)` - the line said once an offer was restored:
  "N earlier change(s) is/are back - not saved yet.", or, when nothing came
  back (live work won), why in the offer's own terms: the notes, this
  tour's "needs no GPS" setting, or both (M1b-2 milestone review #6).
- `editorDraftKey(fileKey)` - `editor:<fileKey>`; `NoBackupReason`,
  `EditorDraftDeps`, `EditorDraftOffer`, `EditorTourSettings` (`open`'s result type stays
  module-private).

## Invariants & assumptions

- **Scope: since the OPENED FILE, not since the last save** (review #2).
  Only an in-place write that landed clears a record (and only one whose
  content it wrote: an edit made while the save ran stays), or a later
  open that finds the content in the file. A download clears nothing:
  "delivered" only means the browser started it.
- **Two base lists** (review #1, the E2p re-review): `seen` (each edit's
  write adds the file's version as it is on disk now - the opened file,
  then each in-place write that landed) and `written` (each build's
  version). A record is offered back only when the file's version is in
  one of them; otherwise it gave way to a newer edit elsewhere and goes,
  said once. **A deletion has no base**: a restored deletion deletes a
  newer edit made elsewhere since (named, not covered).
- **The editor places nothing new**, so a record of an id the file no
  longer carries counts as given way (said with the replaced ones).
- **A photo note's record has no bytes** (milestone review #1): they are
  in the file the editor opened, and the rebuild keeps that entry, so the
  draft is read with `readDraft(store, { photoBytesRequired: false })` - the
  phone's rule dropped a moved photo note's record.
- **Its own namespace** (review #3): `editor:<fileKey>`, never the phone's
  (`draftKeyForTour` of a link or a bare file key); the two drafts meet
  only through their bases.
- **The key moves only after an in-place write that landed** (review
  #5), to the key of the bytes written (`tourFileKeyOfFile`, computed by
  the page before the write). The switch is synchronous: later writes go to
  the new namespace; pending changes and an unanswered (or "Not now")
  offer are written there with their bases. The old namespace is emptied
  (behind its own queued writes, its meta last) ONLY once every carried
  record and the new meta landed (milestone review #2) - a tab closed right
  after "Saved to" finds both, or the old one alone; when anything did not
  land the old one stays. A carried record never claims an id: one "Delete
  it" rejected since the move is skipped (review #5).
  A tour built on a walk recording keeps its key through a save; a tour of
  notes alone changes it with every save; a lean download (the walk left
  out) has another key, which a download never follows.
- **One writer** (review #6): only the tab holding the draft key's Web Lock
  writes; any other tab writes nothing and says it keeps no backup, and how
  to get one (close the other tab, open the tour again here: the lock is
  asked once, `ifAvailable`, at the open). The hold goes when the tour
  closes, after that tour's queued writes landed (milestone review #6) -
  the meta writes and "Delete it"'s removals among them, so a close right
  after "Delete it" keeps the hold until the rejection landed (PR #622 bot
  finding B). A key move lets the old key's hold go once its carried
  records landed, and the next open in this tab waits for that too (the
  close's let-go is chained on it): the pre-save file reopened here never
  finds this tab's own hold and says "another tab" (PR #626 bot finding 2).
- **The no-backup line is about the tour open now**: a closed tour's late
  failure does not use it up. **Every meta write of an open is said when
  it does not land**, the first one too (PR #626 bot finding 1): the
  shared reader reads nothing without a meta, so a refused first meta
  leaves the namespace unreadable, and `backsUp()` turns false with the
  line.
- **Writes per (namespace, id)** through one keyed chain, the meta's under
  its own key; a write to an id the meta rejects claims it first (files
  removed, meta rewritten without it), the phone's `creator-draft.ts` rule.
  At each open the meta is rewritten with the read's pruned rejection list,
  so an id whose files are gone is never left rejected (a later edit of it
  would be hidden). Until a meta write lands, the claim is also made
  against the meta ON DISK (`rejectedOnDisk`, every id it rejects, as the
  phone does): a pruning write that did not land - said, like any write
  that did not land - no longer hides the next edit of such an id (PR #622
  bot finding A).
- **The settings record (QR-first M1b-2, the draft gap).** One file,
  `settings`, in the editor's namespace (not a prefix the phone's
  `readDraft` reads, so the shared reader skips it), in its own queue. The
  objects' rules, for a boolean: kept while the file on disk differs, or a
  build wrote the other value (a build never put in place); offered by a
  later open whose file does not carry it - read whether or not a meta
  landed, since the namespace names the tour; spent or unreadable, it goes;
  a landed write that carries it clears it; a key move carries it (and an
  unanswered offer's), and the old namespace's goes with it; "Delete it"
  removes an offered one after the meta's commit point, awaited, failing
  the discard when it does not land, never one changed since the open.
  **The value last set here is kept** (`settingsWanted`), whether or not
  its record is, and the keep is decided again by each build and each
  landed write (M1b-2 milestone review #1): turned on, a save started, and
  turned off before the build was known, "off" first equals the opened
  file and its record goes - the build's "on" then brings it back, so the
  file says on, the draft says off, and a closed tab keeps "off" (in place,
  on a key move, and as a download alike).
  **No base, and what that costs** (milestone review #3; the first build of
  this bullet claimed the other value was always one "this browser saw or
  wrote", which does not hold): a file that differs from the record holds
  the other value, but this browser cannot tell whether it saw it, wrote
  it, or a colleague made it since - a file F' carrying "on" need not be
  this browser's build. The offer therefore NAMES the setting and its
  value, and the creator decides. Named, not covered: Restore of an offered
  setting can undo a colleague's newer change when the creator does not
  notice the named value; an ABA made elsewhere (on, then off again) cannot
  be told apart and is offered. A version base for one boolean was
  declined as heavier than that risk.
- **Never throws to the page**; a write that did not land is `false` and
  the page hears it once (`noBackup`); the leave guard stays on.
- **Not covered, named:** a carried record that did not land leaves the
  old namespace in place - its key is the overwritten file's, so only a
  copy of that file reaches it - and the page says it keeps no backup; an
  empty directory stays behind each moved namespace; a hold whose queued
  write never settles keeps the next open of the same tour in this tab
  waiting; storage in a private
  window may go with the window; a restored delete has no Undo.

## Examples

```ts
const draft = createEditorDraft({
  openStore: (key) => openDraftStore(navigator, key),
  holdLock: (key) => holdEditorDraftLock(navigator.locks, key),
  noBackup: (reason) => say(NO_BACKUP[reason]),
});
const { offer, superseded } = await draft.open(session.archive.url, manifest);
const editor = createEditorSession({ session, manifest, levels, draft });
```

## Tests

`editor-draft.test.ts` (in-memory stores, one per namespace, and a lock
stand-in): the editor's own namespace and the `seen` base; the offer's
changes and deletions; a deletion without a base; a download clearing
nothing (the original offers, the copy put in place does not); an in-place
save then an edit; a build never put in place; a record given way to an
edit elsewhere; a landed write clearing what it wrote and keeping an edit
made meanwhile; the key move (the later edit under the new key, the old
namespace emptied); a key move carrying a during-save edit and an
unanswered offer; "Delete it" sparing a live edit and a later edit of a
rejected id; the pruned rejection list; the undo of a delete of an edited
note; a second tab; no storage and a failed write said once; the settings
record (offered as a change, counted with the notes', spent when put back
or when the file carries it, a build never put in place, a landed write
clearing it and one made during it kept, key moves, "Delete it", a closed
tour's write dropped, an unreadable record, a failed write said); the
settings record's edge walks (M1b-2 milestone review: a setting turned back
while a save builds, in place, on a key move and as a download; the offer
naming the setting and its value, alone and beside notes; "Delete it"
done only once the record went, failing when its removal does not land,
and re-arming the offer so a key move still carries it); `restoredLine`'s
words for notes, the setting, and both; the same tour
reopened in the same tab; a moved photo note and the undo of a delete of
one (no bytes); the old namespace kept until the carried records landed,
and kept when they did not; "Delete it" right after a key move; a closed
tour's late write dropped; the hold kept until the queued writes landed;
an edit claimed against the meta on disk when the pruning write was refused
(PR #622 A); a close right after "Delete it" holding until its meta write
landed (PR #622 B); a refused first meta write said, and the backup no
longer claimed (PR #626 1); the pre-save file reopened in this tab right
after a key move, not "another tab" (PR #626 2). A
scoped mutation pass (12 mutants of the rules above) killed all 12. The page's walks are in
`playwright-tests/editor.spec.js` (the E2c block).
