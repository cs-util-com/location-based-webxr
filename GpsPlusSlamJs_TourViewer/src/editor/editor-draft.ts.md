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
  - `writes()` - those four bound to the tour open NOW, which the page gives
    the editor session: once another tour opens they are dropped (resolve
    without writing), so a late write of the old editor never lands in the
    new tour's namespace with the new tour's `seen` (milestone review #6).
  - `open(fileKey, manifest)` - closes the last tour's hold, holds
    `editor:<fileKey>`, reads it, clears what the file carries, and
    resolves `{ offer, superseded, backedUp }`: `offer` (`objects`,
    `deleted`, `text` from `restoreOfferText`, changes and deletions named
    apart) or null; `superseded` - `supersededLine(n, "in this browser")`
    or null. Awaited before the tour shows.
  - `restored()` - the session applied the offer (its writes rewrote what
    it applied).
  - `discard()` - "Delete it": the offer's ids, minus those written since
    the open, rejected in the meta (the commit point), then removed; false
    when the meta write did not land (the offer comes back next time).
  - `built(written)` - a save was built: each pending record's version in
    the written manifest (as a reader parses it, `manifestAsRead`) joins its
    base's `written` list.
  - `landed(written, fileKey)` - an in-place write landed: pending changes
    the file now carries clear, the file's versions become the `seen`
    source; when `fileKey` is another key, the draft moves to it
    synchronously.
  - `backsUp()`, `close()`, `idle()`.
- `editorDraftKey(fileKey)` - `editor:<fileKey>`; `NoBackupReason`,
  `EditorDraftDeps`, `EditorDraftOffer` (`open`'s result type stays
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
  closes, after that tour's queued writes landed (milestone review #6).
- **The no-backup line is about the tour open now**: a closed tour's late
  failure does not use it up.
- **Writes per (namespace, id)** through one keyed chain, the meta's under
  its own key; a write to an id the meta rejects claims it first (files
  removed, meta rewritten without it), the phone's `creator-draft.ts` rule.
  At each open the meta is rewritten with the read's pruned rejection list,
  so an id whose files are gone is never left rejected (a later edit of it
  would be hidden).
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
note; a second tab; no storage and a failed write said once; the same tour
reopened in the same tab; a moved photo note and the undo of a delete of
one (no bytes); the old namespace kept until the carried records landed,
and kept when they did not; "Delete it" right after a key move; a closed
tour's late write dropped; the hold kept until the queued writes landed. A
scoped mutation pass (12 mutants of the rules above) killed all 12. The page's walks are in
`playwright-tests/editor.spec.js` (the E2c block).
