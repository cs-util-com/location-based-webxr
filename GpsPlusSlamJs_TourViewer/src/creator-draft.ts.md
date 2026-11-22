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
    when in AR, never overwritten by it), and their files are removed:
    the edits made meanwhile waited (`draft-edit-gate.ts`), so none of
    them is this page's.
  - `writeObject(object, blob?)` - the awaited record write, with its
    seen version: the tour document's listener writes every change through
    it (`creator-setup.ts` hands `draftObjectWrites(draft)` to
    `ctx.tourDocument.follow`).
  - `saveSettings(record)` - writes the document's settings record (the
    tour's setting, details and moved stations; `SETTINGS_KEY`, the
    desktop's file name and shape, `tour-document-draft.ts`) whole, in its
    own queue; true before the namespace opens (nothing to write: no
    edit lands before the draft is read, `draft-edit-gate.ts`), false
    where the tour has no store.
  - `finished(ids, written)` - `creator-finish.ts` after a Finish wrote
    these objects: their versions in `written` are this device's own work.
    The ids (all of this load's Finishes) are kept for `uploaded`.
  - `forgetRefused(tourUrl)` - `tourUrl` was refused as an older format
    (a bare content key, `isTourContentKey`, deletes nothing and reads
    false: it names the recording, which another tour may share; B2a
    review 4)
    (`archive-open.ts`): its namespace (`draftKeyForTour`) is emptied
    with `clear(META_KEY)`, the meta first so a reload midway finds no
    draft, in the meta's queue (after any write queued for it). True when
    a draft was there (its meta); false for none or no persistence; never
    rejects. The refused tour never presented its draft, so no open
    tour's state is touched. The emptied directory itself stays (the store
    empties in place). Only a draft PROVED to be an older version's is
    emptied (`isOlderVersionDraft`; a draft of an older format goes at open,
    `discardOlderFormatDraft` in `present`): a refused older copy and the current
    copy of the same tour share the tour id, so the draft under the key may
    be the current copy's unsaved work. A draft holding a record this
    version reads, or nothing that decides it (no object records, or one
    that does not read), is kept and reads false - it stays until its own
    tour opens; nothing deletes it. A draft this version opened is never
    such a draft (`present` stamps its meta). Tests:
    `creator-setup.test.ts` ("a refused older tour's draft", among them
    one this version opened that holds older records and a deletion).
  - `follow(tourUrl)` (debug-captures plan, Q-I) - the file a Finish
    delivered of a tour opened from a file opens under another key once
    its save wrote the tour's own id: the draft switches to that
    namespace synchronously (every write from then on lands there), copies
    every file of the old one into it inside the queue's `exclusive` task
    (after every write already queued, before every one issued since - so
    the old copy of a file never lands over a newer write; a photo's bytes
    as a blob), and re-states the meta under the new key. The old
    namespace keeps what it holds: the file is not known to be put
    anywhere ("NOT cleared here" in `creator-finish.ts`), so the opened
    file opened again offers what it did. True once the draft is under
    `tourUrl` (or none is open) - also when another follow moved it to
    the same key while this one waited for its open (two quick Finishes of
    the same file; that follow's own copy reports its result); false when
    a listed file could not be read or a write did not land, or another
    tour opened or the draft moved to another key meanwhile.
    `creator-setup.ts` calls it from the hand-off's `onDelivered` with
    `tourFileKeyOfFile` of the delivered file, for a file-opened tour only,
    and on a false or failed move (still the same tour) says no backup is
    kept (`warnNoBackup`, r901 review #7): the saved file then opens under
    a key that holds no draft. Named cost: a move never clears the old
    namespace, so after a move that landed the draft's files - a placed
    photo's bytes among them - are stored twice on the phone, each copy
    until it is cleared where its own file is opened ("Delete it", or the
    spent-draft sweep); the browser's storage quota bounds it.
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
    start one. Every continuation re-checks `ctx.openGeneration`. Right
    after the read it writes the meta once (`recordMeta`, stamped with
    this version's format by `writeDraftMeta`), whether or not a draft was
    there: a deletion writes only its tombstone, and a restore or a code
    no meta, so without the stamp a draft of an older version's records
    plus such work read as older (`isOlderVersionDraft`) and refusing an
    older copy of the same tour cleared it, the deletion with it. That
    write re-states the pruned rejections and rejects nothing new.
  - `reset()` - a tour closed: the offer, the namespace and the
    rejections go.
  - `saveMeta()` - rewrite the open tour's meta (tour, printed size from
    the FIELD, the rejections), queued per namespace. Resolves true with
    no tour open (nothing to write, nothing failed), false where the tour
    has no store; a refused write may reject, as before the split.
  - `saveCodes(codes)` (plan M3b) - write the codes record
    (`draft-persistence.ts`'s `CODES_KEY`: the code in hand and every
    code the hosted zip does not hold yet), in its own queue, the waiting
    draft's codes re-stated after the page's. The document's listener
    calls it (`creator-setup.ts` wires it into `follow`). True with no
    tour's draft open yet (`present` writes this page's codes then).
  - `recordVisit(entry)` - fire-and-forget, in the id's queue; a visit
    made before the namespace opens is written when it does (`present`).
  - `write(id, write)` - one AWAITED write for the object list's actions.
  - `forgetObject(id)` - remove an id's files after any write queued for
    it.
    Its base goes with them, so the versions this load's Finishes wrote
    and its uploads noted are kept in memory per id, and a record written
    again for a forgotten id (`writeObject`) gets them
    back after its record: without them a reopen would call this device's
    own saved work "replaced by a newer one". Cleared by `reset`.
  - `warnNoBackup()` / `persists()` - the once-only "not saving a backup
    copy" note; `persists()` is true only once the open tour's draft took
    the page's earlier work (`present` queued it into that open's store,
    or ran to its end) and no such note was said, so it is false while
    unstored work waits in memory - no tour open, its manifest not
    settled, its draft still opening. A read that fails before the
    earlier work is queued leaves it false: that work is not stored. A
    slow hosted comparison after it does not hold it back. The leave
    guard reads it, with "a tour is open", as its one fact
    (`creator-setup.test.ts` "keeps asking before leaving while the
    settled tour's draft is still opening", "reports the draft as backing
    up once the earlier work is queued, before a slow hosted read ends").
  - Every `present` continuation is stale once the open generation moves
    OR `reset` ran: a late integrity failure tears the tour down inside
    the same open, so the generation alone would let the continuation
    attach the closed tour's store and report it as backing up
    (`creator-setup.test.ts` "keeps asking when the tour is torn down
    while its draft is still opening").
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
- **Nothing but visits and codes is made before the draft opens**:
  placing waits for the tour's settle, which presents its draft in the
  same step (`archive-open.ts`), and an edit made while the draft is read
  waits for it (`draft-edit-gate.ts`; the placement note says
  `DRAFT_BEING_READ` meanwhile). With no tour open there is no
  namespace - that is not a storage failure and does not spend the one
  warning. When the store is assigned, the visits made meanwhile are
  written (after the read, so no branch deletes them), and a level
  measured before the open is recorded in the codes record (`writeCodes`,
  the offered draft's codes re-stated after it) even when an older draft
  is being offered.
- **A draft is OFFERED, never applied.** It can be days old and can be one
  the creator believes they discarded; restoring it silently would append
  content they did not ask for into a zip they are about to publish. Three
  answers: add it back, not now (kept), delete it (gone). "Not now" keeps
  it because a mis-tap must not become the loss this exists to prevent;
  "delete it" exists because a draft with no way out is offered forever.
- **"Not now" is for looking only; the first edit asks again.** From
  `present` on, every edit of the tour document waits in the store's
  draft gate (`draft-edit-gate.ts`, `ctx.store.draftGate`) until the
  draft is decided. The first edit that waits shows the offer again, its
  words saying so (`DRAFT_EDIT_WAITS`; in AR the placement note says
  `DRAFT_EDIT_WAITS_IN_AR`). Restore drops the edits that waited (each
  was built from the document before the draft came back, so replayed
  after it it would write its old values over the draft's), applies the
  draft and appends `DRAFT_EDIT_MAKE_AGAIN` to its note; a landed "Delete
  it" deletes the draft, then applies them in their order; "Not now"
  cancels them (nothing applied, the note says `DRAFT_EDIT_NOT_APPLIED`),
  and the next edit asks again. A draft with nothing to offer, or a read that
  failed, lets them through at once. A close or another open ends the
  question: what waited is dropped with the tour (`reset`, and the gate
  itself on the document's `opened` / `closed`). So no edit ever lands
  on an undecided draft, which is what keeps every write below free of
  "live work" rules. The offer's status lives here, not in the store: a
  deviation named in `draft-edit-gate.ts.md`, with a draft status slice
  as its follow-up. The codes are not gated (their record re-states the
  waiting draft's, below).
- **AR starts only once the draft is decided** (`readyForAr`, through the
  session's `creatorDraftDecided` hook, asked by `ar-entry.ts` before the
  author pipeline starts). In AR the offer is out of sight, and an edit
  there would wait for a question nobody sees. `readyForAr` answers at
  once and never waits (WebXR starts only inside the tap's own user
  activation): while the read runs (the store's `tourDraft` is
  `reading`) it says
  `DRAFT_BEING_READ`, while "Delete it" runs `DRAFT_DELETE_RUNS`, with an
  offer open it shows it again with `DRAFT_DECIDE_BEFORE_AR`; each keeps
  AR unstarted, and the next tap asks again. The read's end, a throw and
  a teardown each clear `DRAFT_BEING_READ`; a stale read's end clears it
  only when no newer read runs. A tour a scan opens in the middle of an
  AR session can still meet an undecided draft there, which is what
  `DRAFT_EDIT_WAITS_IN_AR` is for: it says that Restore drops what was
  made in AR. Restore's note uses `draftEditsMakeAgain(dropped)`.
- **"Delete it" shows its progress** (`async-ui-feedback`): the three
  answers are disabled and its label reads `DRAFT_DELETING` from the tap
  until the commit says how it went; a
  commit that did not land re-enables them, reverts the in-memory
  rejection, says so (its own note) and keeps the question, the waiting
  edits still waiting.
- **Restoring brings the LEVEL and the SIZE back too**, not just the
  objects. The level is what makes Finish reachable without walking to the
  poster again; the size is rewritten from the framework default on every
  load, so without it a re-entry would solve against 16 cm for a poster
  printed at 20. A live measurement wins over a drafted one - it is newer.
- **"Delete it" is committed by ONE meta write, and undone by a second if
  that one fails.** The handler records the rejected ids in the meta file
  and only then removes their object files, unawaited: a tab closed
  before they went leaves them inert, because the next read refuses every
  rejected id (`draft-shared-behaviour.test.ts`, "discard: a tab closed
  right after the rejection landed ..."). If the write does not land, the
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
  id's queue (`gps-plus-slam-app-framework/utils/keyed-chain`, keys per tour namespace and id), so they
  land in call order.
- **A change to an id the meta rejects CLAIMS the id first**
  (`writeForObject`, `claimObject`). The meta's rejected list outranks an object's
  files, so an edit or delete of an object a spent draft or "Delete it" had
  rejected was hidden by the next read and swept by the next open - the
  edit lost, or the deleted object back. In the id's queue, each step
  awaited: remove the rejected files, rewrite the meta without the id,
  then write the change. A crash between steps leaves the rejection or
  nothing for the id, never the rejected version. A sweep (discard, spent,
  an unfinished earlier sweep) removes an id's files only if it is STILL
  rejected when its turn comes, so a claim made meanwhile survives it.
  The claim follows the store the write goes to, as a record's does
  below (`claimElsewhere`): a write that runs after the tour closed or
  after a `follow` moved the draft claims by that store's own meta.
  The claim is made against the meta ON DISK too (`rejectedOnDisk`, then
  each landed meta write's list), not only the pruned in-memory list: after
  "Delete it" and a reload the pruned list no longer names an id whose files
  are gone while the meta still rejects it, and an edit of it was hidden at
  the next read and swept - deleted for good; a deletion came back at the
  next Finish (found building M6 E2c, its milestone review #3).
- **A write of the codes before the offer is answered keeps the stored
  draft's codes** (M6 E2c review #3, a codes record since plan M3b): the
  open reads the codes record first, in the codes queue, into its holder;
  every later write of the codes runs after that read and re-states them
  as they stand when it runs - `level` falls back to the draft's, its
  `levels` after the page's (a live code with the same id wins) - until
  Restore makes them the page's or a rejection of the draft LANDS; "Not
  now" keeps them. "Delete it" queues, at the tap, a write of this page's
  codes that waits for the meta's commit: a commit that is refused writes
  nothing and keeps them (before M3b a refused discard forgot them, and
  the next write dropped the draft's measured code); between the commit
  and that write a reload offers the rejected codes again, the safe
  direction. A spent draft re-states nothing: the codes are written
  again, this page's only, once its commit landed.
- **Restore puts the whole draft back** (`restoreWork`): every edit
  waited for the answer, so the document holds nothing of this open's
  that the draft could outrank; the edits that waited are dropped, and
  the note says to make them again.
  Its note counts what it put back: the draft's code position is claimed
  only when `restoreInHand` took it (a code measured here keeps its
  place), and visits only those whose ids the log did not hold already.
  The sweep spares this page's visit ids (`notLive`); the restore puts
  back by object ids alone, so a draft object whose id equals a visit id
  is still put back.
- **A live record takes its id's tombstone away, after it, once it
  landed** (`writeDraftLiveRecord` in `draft-persistence.ts`, shared with
  the desktop editor's `saveObject`; for `writeObject`): an older
  draft's tombstone outranks a record in `readDraft`, so without it an
  edit made over an offered deletion (landing after the answer) was
  offered as deleted again at the next reload, and a crash after the edit
  brought it back deleted. Record first, then the
  tombstone, as an undo of a delete writes them: a crash between the two
  leaves the object deleted, never half restored.
- **A draft is deleted only on PROOF**: a re-opened tour whose `tour.json`
  already carries its ids. Not on the download tap - on Android that
  resolves true the moment a download starts, and the creator still has to
  upload the file by hand afterwards.

## The settings record (tour editor plan §19 #1)

The tour document's settings record (`tour-document-draft.ts`: the
setting, the details once set, every station's pose once one moved, the
whole frames of the stations this page created) is one file, `settings`
(`SETTINGS_KEY`), in the tour's namespace - the desktop's name and shape
(`editor/editor-draft.ts`), read by the same `parseSettingsRecord`, against
the opened tour, whose assets and characters a stored frame may name. What
did not read is told on the status line (`DRAFT_PART_UNREAD`), beside any
other note of the open, as is a captured photo whose bytes did not read
(`StoredDraft.photosUnread`; `creator-draft-follow.test.ts`, seen red:
no word at all); a record with a station that did not read is kept
though spent, since a corrected file reads it again, until the next whole
write. The
document's listener writes it whole on each change, in its own queue. The
phone offers and restores the WHOLE record, by the desktop's rule
(`settings-record-offer.ts`, one module for both pages):

- **Offered** when it changes anything the opened tour holds (the details,
  a station's pose, a station's own fields, the order, a deleted or an
  added station, the characters: `changesSettings`), or holds a station
  the draft's objects name that the tour lacks (`addsStations`). Such a
  record is work like any object: the draft is not spent while it waits.
  The offer counts it as the desktop does (`settingsChangeCount`) and
  names its parts after the objects' words ("Changed: the tour's details
  (name), and the order of the stations."); an item a recorded frame moves
  between a story and the free items counts with that frame
  (`movedIds`), never as a thing placed, a change or a deletion of its
  own (a new item's record left behind by a broken removal included). The
  offer's words and Restore's line read the same `counts`.
- **The "needs no GPS" setting is never the phone's**: the record's copy
  is read as the opened tour's, so an older copy written here never undoes
  a change of it made in the editor.
- **A recorded cover naming no image of the tour** (a photo deleted
  since) is no opinion about the cover (`heldAgainst`), as on the
  desktop.
- **Restored** through `restoreWithSettings`, as the desktop restores:
  the moved poses, the created and hand-made stations and the recorded
  frames before the objects (the slice's `restored` puts them first), so
  each item's record lands in its own station; then the order, the deleted
  stations, the characters, and the details as the details form checks
  them. A station moved while the offer stood waited, and Restore dropped
  it: made again, it lands on the restored pose.
- **Remaining risk, the desktop's too**: the record has no base, so its
  details or frames restored over a newer change of them made in the
  editor since (the tour file moved on) put the older values back; the
  offer names what it would change, so the creator sees it before saying
  Restore.
- **Read first, in the record's own queue**: the edits made meanwhile
  wait, so the page's first write of the record follows the read.
- **No pose rides along**: no edit lands while the stored record is
  undecided, so every record this page writes is the document's own,
  whole. The per-open holder `present` makes (`CodesHolder`) holds the
  codes only; every `writeCodes` call names the holder of the open it
  writes for, so a write still queued when the tour closes carries its own
  tour's codes.
- **Removed** with a spent draft (after its meta commit; not while a
  station in it did not read, which a corrected file reads again) and by
  "Delete it", whose rejection always names the record
  (`SETTINGS_REJECTED`, in the same meta write as the objects' ids; the
  next read prunes the entry once no file is left): a
  tab closed before the removal leaves it inert, never offered again, and
  the next open sweeps it. The removal is queued before the waiting edits
  land, whose own record claims the rejection first (`claimRecord`:
  removed, the meta rewritten without the entry, then written). The claim
  follows the store the write goes to: while it is the open tour's, by
  that tour's lists; once the tour closed or a Finish moved the draft
  (`follow`) since the write was queued, or while its removal ran, by
  that store's own meta (`claimElsewhere`), written directly: a
  `follow` holds every queue until the write ends, so a claim through
  the meta's queue would wait for the move while the move waits for it.
  `claimElsewhere` notes each id and entry it claims per store, and
  `follow` drops exactly those from the moved list, so the new meta does
  not reject the copied write; an id whose rejection stands (a spent
  draft whose sweep did not land) stays rejected. The note is dropped
  when the store opens again: its read already holds the claim.
  **Residual race:** `claimElsewhere` reads and rewrites the meta outside
  the meta's queue, so a `recordMeta` queued for that store before the
  switch and landing between the read and the rewrite can re-reject the
  entry, and the next open then hides that write. It needs a meta write
  of the old tour still queued at the move, and is not covered by a test;
  closing it would mean awaiting the old meta queue before the move's
  `exclusive`. A
  commit that lands after a close removes the record unless the tour was
  reopened. A reopen whose settings read ran before the commit landed
  refuses the record it read once its `readDraft` sees it rejected
  (`rejectedOnDisk`), so the deleted record is never offered alone; that
  open sweeps it.
- **The codes record goes with the draft too**: while the page holds no
  code, the commit names `CODES_REJECTED`, so a tab closed right after it
  leaves the old codes inert. While it holds one, the record holds the
  page's codes beside the draft's, so the commit does not name it: a tab
  closed before the rewrite would otherwise lose the page's codes; it
  offers the deleted draft's codes again instead, beside the page's. The
  codes write queued at the tap then writes this page's codes (an empty
  record when it holds none), claiming the record back; every
  later `writeCodes` claims it first by the same rule. An interrupted
  removal of a spent record is safe: a record the opened tour carries is
  spent again at the next open.

## The question in the store

The draft question's status, the offer's words, "Delete it"'s progress and
the count of waiting edits are the store's `tourDraft` slice
(`tour-draft-slice.ts`), shared with the desktop editor. `present`
starts a question (`readStarted`) and keeps its `generation` (`asked`);
the read ends it as `found` or `noneFound` (also with no draft store, and
for a read that threw; the no-storage line is the placement note, never
store state); the answers
dispatch `restored`, `declined`, `deleteStarted` / `deleteEnded`, and
`reset` dispatches `questionEnded`. The offer's DOM is drawn from
`selectDraftOffer` by a store subscription (`drawOffer`), which draws
only when the slice changed. What stays in this module: `offered`, the
side table of the offer's records and photo bytes, and the guards
(`presentEpoch`, `ctx.openGeneration`).

## Every end of the wait draws what waited

An edit made while the draft is read or offered waits in the gate
(`draft-edit-gate.ts`), so its own preview sync and readout ran while it
was held and drew nothing. Every way the wait ends lets the waiting edits
through by one function (`released`), which then syncs the previews and
renders the readout: a read that found no draft or nothing to offer, a
read that threw, Restore and "Delete it" (`decided`). A landed pin with
no preview reads as a lost tap, and the creator places it again - a
duplicate at the same spot in the published tour
(`creator-setup.test.ts`, "draws a pin that waited ..."). "Not now" and
a tour change drop the waiting edits instead; a dropped placement gives
its "New station here" arm back (`creator-placement.ts.md`) and frees its
photo's bytes (`creator-document.ts.md`).

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

The codes record (plan M3b), through `wireCreatorSetup`: the
characterization tests of the waiting draft's codes and the spent rule,
moved from the meta to the codes record rule for rule, and a "Delete it"
whose commit is refused keeping the draft's codes (checked to fail with
them forgotten at the tap).

Composed, through `wireCreatorSetup` and unchanged by the split:
`creator-setup.test.ts` (the offer, its three answers after a Finish too,
the ordered writes, the claims and sweeps; "the draft keeps a moved
station's pose" for the settings record, a write queued across a close, a
"Delete it" that did not land and one that landed after another tour
opened among them, a rename made while "Delete it" runs landing after it,
one that waited going with the tour when it closes first while the
landed removal takes the record, and one leaving the record to a reopen
through the same url padded; edits, deletions, moves and placements made
while the draft is read waiting, dropped by Restore with its note and
landing after "Delete it"; "Not now" dropping a waiting edit with its
note; the note while the draft is read; the start of AR asking first; an edit over an offered deletion not offered as deleted again, and
one whose record did not land keeping the tombstone; Restore's note
counting the whole draft with the waiting edit dropped, beside a
code measured here and beside visits the log already held; a draft object
whose id equals a visit id restored; the waiting draft's codes re-stated
after the page's, the page's winning, kept through "Not now" and dropped
by "Delete it", and the spent rule judging each code by the hosted zip's
content - spent when it holds the same text, kept and offered when it holds
another, none, or cannot be read - pinned before the codes move into the
store, plan 2026-10-20-1159 M3a), `creator-finish.test.ts` and
`authoring-settle.test.ts` (the meta a mint or settle writes, the backup
notice), plus the draft e2e specs. `follow` in isolation:
`creator-draft-follow.test.ts` (a record written again after a forget
keeping the versions a Finish wrote, so a reopen offers it; every file copied, a photo as a blob, the
meta re-stated, later writes in the new namespace, the old one kept; a
write issued during the copy never overwritten by it; an unreadable file
reported; nothing opened for the same key; two follows to the same key at
once both true, to two keys the later one false; and "Delete it"'s commit point holding the settings and codes records, all seen red first: a
settings write that runs after the tour closed or after a `follow` claims
the rejection, a reopen the commit lands in the middle of offers nothing,
a tab closed right after the commit leaves the codes inert but keeps a
code the page measured, and a code
written after "Delete it" claims the codes record; an object edited after
"Delete it" whose write runs after the tour closed, after a `follow`, or
across a `follow` that starts during its claim's removal is offered at
the next open, and the move ends); composed, two Finishes and the
reopen of the saved file: `tour-document-parity.test.ts`. The gate: `draft-edit-gate.test.ts` (rows and a property);
the rule across both pages, with random view / "Not now" / edit /
Restore / "Delete it" / reopen sequences: `draft-shared-behaviour.test.ts`.
The pure rules are in
`authoring-draft.test.ts` and the on-disk shape in
`draft-persistence.test.ts`. The sampled mutants of the region "draft"
(`scripts/fixtures/creator-setup.mutants.json`) are killed.
