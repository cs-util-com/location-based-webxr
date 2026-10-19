# creator-draft.ts

## Purpose

The creator's on-device draft (second testing session, F13): the crash-safe
copy of a tour's authoring work and its offer when the tour is opened
again. (Until code book plan M6 it also kept the move prompt's answers; a
meta that still carries them restores, the answers unread.)
Split out of `creator-setup.ts` unchanged in the code book refactor plan's
M2 (`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`).

## Public API

- `wireCreatorDraft({ ctx, dom, openDraftStore, visitLog, codes, wizard, sessionLive, syncPreviews, render }): CreatorDraft`
  - `dom` (`CreatorDraftDom`): `sizeInput` (written to the meta, restored
    from it), `draftOffer`, `draftOfferText` and the three answers
    `draftRestore` / `draftDismiss` / `draftDiscard`, whose clicks this
    module handles.
  - `visitLog` is `creator-setup.ts`'s page-side log: a restore fills it, a
    visit is recorded into it, and `notLive` keeps this page's visits out
    of any sweep.
- `CreatorDraft`:
  - The base (M6 E2p, its review and re-review): `present` compares with
    the tour AS OPENED, which the document keeps (`opened()`; a Finish
    later advances the document's written tour to what this page wrote,
    which is not hosted until the creator uploads it) - no copy of its own
    (the r880 milestone review LOW-5). Every
    draft write of an object adds the opened tour's version of it as seen,
    taken when the write is queued (a queued write can run after another
    open, whose tour is not the one edited); `finished(ids, written)` adds a
    Finish's versions as written, keyed as a reader of the written file (`manifestAsRead`, `authoring-draft.ts`)
    parses them; records the hosted zip carries unchanged
    are added as seen on open (`draftObjectsPublished`). Superseded
    records are not offered, one line says so (combined with the AR note
    when in AR, never overwritten by it), and their files are removed -
    unless this page changed them again first (`notLive`).
  - `writeObject(object, blob?)` - the awaited record write, with its
    seen version: the tour document's listener writes every change through
    it (`creator-setup.ts` hands `draftObjectWrites(draft)` to
    `ctx.tourDocument.follow`).
  - `saveSettings(record)` - writes the document's settings record (the
    tour's setting, details and moved stations; `SETTINGS_KEY`, the
    desktop's file name and shape, `tour-document-draft.ts`) whole, in its
    own queue; true before the namespace opens (`present` writes this
    page's then), false where the tour has no store.
  - `finished(ids, written)` - `creator-finish.ts` after a Finish wrote
    these objects: their versions in `written` are this device's own work.
    The ids (all of this load's Finishes) are kept for `uploaded`.
  - `uploaded(written)` (follow-up F19, owner decision 2026-10-14) - the
    creator answered yes to "did you upload it?" (`creator-handoff.ts`),
    and `written` is the tour.json of the file the question was asked
    about, never a later Finish's (F19 review #2): every object a Finish of
    this load wrote gets its version in `written` added as SEEN (`addDraftBaseKey`, in the id's queue), so a delete
    made elsewhere afterwards is honoured instead of offered back. Resolves
    whether every note landed (true with nothing to note - and true on a
    phone without a draft store or before the tour's namespace exists,
    where no later open could offer anything back, so a yes never says
    "could not note it" there, PR #626 bot finding 3); a note that did
    not land leaves no base, which is never superseded (the safe side).
  - **Not covered (E2p review #3, #7).** A desktop delete is honoured only
    once a version of the record was SEEN hosted. Nothing tells the phone an
    upload happened (`rebuiltZip.delivered` is not proof of one), so since
    F19 the phone asks once after a delivered Finish; without a yes the usual
    walk (place, upload, delete on the desktop, with no phone open in
    between) still offers the pin back, as before - the offer is a question
    the creator can decline. A yes given for a file that was NOT uploaded
    makes the phone's own new objects read as "deleted elsewhere" at the
    next open of the old file, and they are not offered back: the question's
    words say to answer yes only once the file is replaced. And a
    record superseded by a desktop edit is dropped whole: a code move the
    phone made to it since is not merged. And (third review #3, #4) a
    Finish that completes before the draft namespace opens records no
    written versions, and its objects are not in the live set that guards
    the open's removals: the window is the OPFS open right after the
    manifest settles, which a Finish (an AR visit, a rebuild) cannot fit
    in.
  - `present(tourUrl)` - a tour opened and its manifest settled: open the
    namespace, then sweep a spent draft, offer what is not hosted yet, or
    start one. Every continuation re-checks `ctx.openGeneration`.
  - `reset()` - a tour closed: the offer, the namespace and the
    rejections go.
  - `saveMeta()` - rewrite the open tour's meta (tour, printed size from
    the FIELD, the code in hand from `creator-codes.ts` and every code the
    hosted zip does not hold yet as `levels` (M4c-1), the rejections),
    queued per namespace. Resolves true with no tour open (nothing to
    write, nothing failed), false where the tour has no store; a refused
    write may reject, as before the split.
  - `recordPlacement(object, blob?)`, `recordVisit(entry)` -
    fire-and-forget, in the id's queue; before the namespace opens they are
    written when it does (`present` writes the document's live work with
    `recordPlacement`).
  - `write(id, write)` - one AWAITED write for the object list's actions.
  - `forgetObject(id)` - remove an id's files after any write queued for
    it.
  - `warnNoBackup()` / `persists()` - the once-only "not saving a backup
    copy" note, and whether it was said.
- `hostedLevelJson(session, levelId)` - what the HOSTED zip stores for a
  level (the content, not the id's presence), or null when unreadable.
  Exported because the measuring path asks it too.

## Invariants & assumptions

Everything measured and placed lives in page memory until Finish, and an AR
session on a phone can be killed by the OS at any moment. So each mint and
each placement is also written to an OPFS draft, keyed by the tour's url
after trimming (`draftKeyForTour`), which is the namespace name
(`authoring-draft.ts` holds the rules, `draft-persistence.ts` the on-disk
shape, and the framework's `opfs-draft-store.ts` the mechanics).

- **NOT the File System Access API.** F13 asked for write access to the
  hosted zip; the pickers do not exist on Chrome for Android, which is the
  only device the creator's AR session runs on. See the plan's §10.1.
- **The write is fire-and-forget.** The placement already happened in
  memory; a storage problem must never fail the tap that made it. A failed
  write says so ONCE, in the panel - a creator mid-walk cannot act on it
  more often than that.
- **Work made before the draft opened is written when it opens**
  (scan-to-open plan §9 #5): with no tour open, or between an open and its
  manifest settling, there is no namespace yet - that is not a storage
  failure and does not spend the one warning. When the store is assigned,
  the in-memory placements the read did not return are written (after the
  read, so no branch deletes them), and a level measured before the open is
  recorded in the meta even when an older draft is being offered.
- **A draft is OFFERED, never applied.** It can be days old and can be one
  the creator believes they discarded; restoring it silently would append
  content they did not ask for into a zip they are about to publish. Three
  answers: add it back, not now (kept), delete it (gone). "Not now" keeps
  it because a mis-tap must not become the loss this exists to prevent;
  "delete it" exists because a draft with no way out is offered forever.
- **Restoring brings the LEVEL and the SIZE back too**, not just the
  objects. The level is what makes Finish reachable without walking to the
  poster again; the size is rewritten from the framework default on every
  load, so without it a re-entry would solve against 16 cm for a poster
  printed at 20. A live measurement wins over a drafted one - it is newer.
- **"Delete it" is committed by ONE meta write, and undone by a second if
  that one fails.** The handler records the rejected ids in the meta file
  and only then removes their object files. If the write does not land, the
  in-memory rejection is restored AND re-written behind any snapshot a mint
  or finish already took - best-effort, since the store that refused may
  refuse again - so a queued write cannot commit a discard the creator was
  told had failed. It removes nothing in that case - and the
  creator is told, in its OWN words and every time, because a discard that
  silently did not happen is met again on the next open with no
  explanation. Deliberately NOT the shared "not saving a backup copy"
  notice: that one fires once per wiring, so an earlier refused write would
  have left this branch mute, and its wording says nothing about the draft
  the creator just tapped Delete on. So an interrupted or failing sweep cannot
  bring the draft back, and a reload before the
  write lands sees the draft exactly as it was - safe in both directions,
  which neither earlier shape was. The ids come from what `readDraft`
  returned, so a placement made while the offer sat on screen is never in
  the list. The rejection is re-stated on every later meta write, and the
  leftovers of a sweep that did not finish are swept on the next open.
- **Meta writes are ORDERED PER NAMESPACE.** They all target one key in one
  directory, and the mint and finish ones are never awaited, so an earlier
  write landing later would overwrite a newer one - a rejection, or a
  measured level replaced by the null it captured. Each write queues behind
  the last for its own NAMESPACE - the trimmed url the directory is named
  from, not the raw one, since two urls differing only in whitespace share a
  directory and must therefore share a chain. That makes both properties
  structural: a tour
  whose write stalls blocks only itself, and the ordering survives any
  interleaving of opens.
- **So are an object's writes, PER ID** (M4 review #7; the M2c review's
  filed #7). A placement's write is unawaited, so a quick delete of it
  could land first and the object come back on the next open. Every write
  and removal for one id - record, bytes, tombstone, a sweep - runs in that
  id's queue (`keyed-chain.ts`, keys per tour namespace and id), so they
  land in call order.
- **A change to an id the meta rejects CLAIMS the id first** (M4 review
  #1, `writeForObject`). The meta's rejected list outranks an object's
  files, so an edit or delete of an object a spent draft or "Delete it" had
  rejected was hidden by the next read and swept by the next open - the
  edit lost, or the deleted object back. In the id's queue, each step
  awaited: remove the rejected files, rewrite the meta without the id,
  then write the change. A crash between steps leaves the rejection or
  nothing for the id, never the rejected version. A sweep (discard, spent,
  an unfinished earlier sweep) removes an id's files only if it is STILL
  rejected when its turn comes, so a claim made meanwhile survives it.
  The claim is made against the meta ON DISK too (`rejectedOnDisk`, then
  each landed meta write's list), not only the pruned in-memory list: after
  "Delete it" and a reload the pruned list no longer names an id whose files
  are gone while the meta still rejects it, and an edit of it was hidden at
  the next read and swept - deleted for good; a deletion came back at the
  next Finish (found building M6 E2c, its milestone review #3).
- **A meta written before the offer is answered keeps the stored draft's
  codes** (M6 E2c review #3): `level` falls back to the draft's, and its
  `levels` are re-stated beside the page's (a live code with the same id
  wins), until Restore makes them the page's or "Delete it" rejects them;
  "Not now" keeps them. A spent draft re-states nothing.
- **Work done before the draft opened is written after the read, ALL of
  it** (M4 review #2): an edit or a deletion keeps its id, so the draft
  may hold an older change of the same id, and writing only ids the draft
  lacked left that older change for a crash to bring back.
- **Live work is every id changed since the open, also once a Finish
  wrote it** (`touchedIds`; the r880 fix re-review, P1). The document's lists
  (its entries and deletions) lose what a Finish wrote, while the offer
  stays on screen; judged by those alone, Restore after a Finish brought
  back an older version of a note changed or deleted here, and "Delete it"
  rejected the live record of a changed one. Every id the document's
  writes name (`write`, `writeObject`, `forgetObject`) joins the set, which
  only `reset` clears - the desktop editor's `touched`. Restore skips
  those ids, and "Delete it" never rejects them (`liveIds`, `notLive`).
- **A draft is deleted only on PROOF**: a re-opened tour whose `tour.json`
  already carries its ids. Not on the download tap - on Android that
  resolves true the moment a download starts, and the creator still has to
  upload the file by hand afterwards.

## The settings record (tour editor plan §19 #1)

The tour document's settings record (`tour-document-draft.ts`: the
setting, the details once set, every station's pose once one moved) is
one file, `settings` (`SETTINGS_KEY`), in the tour's namespace - the
desktop's name and shape (`editor/editor-draft.ts`), read by the same
`parseSettingsRecord`. The document's listener writes it whole on each
change, in its own queue. The phone reads only its STATION POSES back:

- **Offered**: the poses that differ from the opened tour's
  (`changedStations`) are work like any object - the draft is not spent
  while one waits, and each moved station counts as one change in the
  offer.
- **Restored** frames first (the slice's `restored` moves them before the
  objects), so the moved items' records land inside their moved stations -
  unless a station was moved here meanwhile: live work wins.
- **Read first, in the record's own queue**, before this page writes it:
  settings changed here before the draft opened (`touched`) are written
  after the read. Only a station moved HERE outranks the stored poses; a
  name (the kept name re-applied at every open, `tour-name-field.ts`) or
  another setting does not.
- **Undecided poses ride along** (the r880 milestone review HIGH-2): while
  the stored poses are neither restored nor discarded (offered, or "Not
  now"), every record this page writes WITHOUT poses carries them
  (`undecided`, applied when the write runs), so a rename never costs a
  moved station. The poses sit in a holder made PER OPEN by `present` and
  dropped by `reset`; a write captures the holder of the open it was
  issued in, so a write still queued when the tour closes or another opens
  carries its own tour's poses, never none and never the next tour's (the
  r880 fix re-review, L2). "Delete it" drops them only once its rejection
  landed: a rejection that did not land leaves the draft, poses and all,
  for a later rename to carry (L3).
- **Removed** with a spent draft (after its meta commit) and by "Delete
  it" (after the rejection lands), unless this page changed the settings
  since the open - then "Delete it" rewrites the live record without the
  rejected poses. An interrupted removal is safe: a record the opened tour
  carries is spent again at the next open.
- The record's details and setting are not offered on the phone (it edits
  only the tour's name, plan W2; its "needs no GPS" is the editor's,
  Q-QF-1).

## Visits in the draft (authoring plan 2026-09-28-0953 M3b)

- Each entry is written to the draft as its own file (`writeDraftVisit`,
  in the id's queue like a placement, fire-and-forget, `noteNoPersistence`
  on a refusal); entries made before the draft opened are written when it
  opens. A restored draft brings its visits back into the log; a dismissed
  one does not. A visit's id is a stored id, so a discard sweeps it with
  the objects; this page's own visit ids are never swept (`notLive`).
- **Visits keep a draft alive** (M3a/M3b review #5): the zip never carries
  them, so `draftIsSpent` gets the read's visit count and a draft holding
  one is never spent - it is offered ("N AR visits for the summary map")
  until the author restores or discards it. Before, a draft holding only
  re-scan visits of a hosted code counted as spent and the reload's sweep
  deleted the visit files. The cost: such a draft is offered on every
  reload of the tour until a discard.

## Tests

Composed, through `wireCreatorSetup` and unchanged by the split:
`creator-setup.test.ts` (the offer, its three answers after a Finish too,
the ordered writes, the claims and sweeps; "the draft keeps a moved
station's pose" for the settings record, a write queued across a close and
a "Delete it" that did not land among them), `creator-finish.test.ts` and
`authoring-settle.test.ts` (the meta a mint or settle writes, the backup
notice), plus the draft e2e specs. The pure rules are in
`authoring-draft.test.ts` and the on-disk shape in
`draft-persistence.test.ts`. The sampled mutants of the region "draft"
(`scripts/fixtures/creator-setup.mutants.json`) are killed.
