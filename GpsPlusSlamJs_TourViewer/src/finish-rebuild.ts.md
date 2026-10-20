# finish-rebuild.ts

## Purpose

The Finish's rules without a page (Tour Viewer M6 E0, B10's "shared
business logic", root `CLAUDE.md` DEC-H3): from an open tour and the edits
to it, the finished zip. The phone's Finish (`creator-finish.ts`) and the
desktop editor (M6 E1/E2, `/tour/edit.html`) call this one module, so a
desktop save cannot skip a rule - deleted photos left in the zip, a dead
signature, a broken series list (M6 design §5, cold review #2). Design:
`GpsPlusSlamJs_Docs/docs/2026-10-13-0832-tour-desktop-editor-and-scan-data-design.md`.

## Public API

- `rebuildFinishedTour(input: FinishInput): Promise<FinishedTour | null>`
  - `input.tour` - the open tour (`FinishTour`: a `TourSession`'s
    `entries`, `manifestWrap`, `integrity`, `budget`, `readWholeArchive`).
  - `input.manifest` - the manifest the tour carries now (after any
    earlier rebuild; an empty one for a tour without). It is written at
    version 3 through `withTourContent` (`tour-content.ts`): the edits
    apply to its world view (`tourObjects`), and every pin and photo is
    written into the station it names - the stations are the manifest's
    as they are (the tour document seated every object). A manifest
    carries no debug camera captures (the format has no field for them).
  - `input.placed` - objects placed or edited (`{ object, blob? }`); a
    photo with bytes writes them as its content file. Read synchronously
    at the call: pass a snapshot, not a list the page keeps changing.
  - `input.deleted` - ids to delete.
  - `input.levels` - code levels to write (`LevelText`, in order).
  - `input.title` - the typed name: one that says something (trimmed)
    becomes `title`; an emptied one removes it (W2 of the tour editor
    plan 2026-10-17-1816: it used to keep the old title silently); null or
    omitted keeps the tour's own.
  - `input.keepScan` - keep the entries visitors never read.
  - `input.previous` - the last rebuild of this open tour
    (`{ blob, signedManifest? }`); null or omitted for the first, which
    reads the tour and inflates it under `tour.budget`.
  - `input.now` - the clock for a series version's `createdAt`.
  - `input.shouldContinue` - checked after the read, before the rebuild:
    false returns null and rebuilds nothing (the tour was closed).
  - `input.onProgress(done, total)` - the rebuild's progress.
  - Resolves `{ blob, written, signedManifest?, scanLeftOut, source }`;
    `source` is the bytes the rebuild read (the open tour's own for the
    first, the previous rebuild's after it): the phone's "Save the debug
    data" keeps the first one's (`creator-debug-save.ts`, debug-captures
    plan M2).
  - Throws what the manifest serializer (a duplicate id), the writer (an
    object in no station of the manifest), the read and the rebuild throw
    (`ArchiveLimitError`, `TourIntegrityError`); the caller shows it.

- `finishedManifest({ manifest, placed, deleted, title? })`
  - the manifest a Finish writes, without the zip: the rule
    `rebuildFinishedTour` applies (records replacing theirs by id, new ones
    appended, deleted ones out, every object in the station it names by
    `withTourContent`), exported pure so the tour document's
    `manifestToWrite` (`tour-document.ts`) and the rebuild cannot disagree
    (property-tested there against real zips). Deterministic: it starts
    no station and mints no id.

- `pendingAfterRebuild({ placed, deleted }, written, appliedDeletions)`
  (M6 E0b) - what is still to save after a write, from the page's lists
  as they are AFTER it: `placed` (content the zip does not carry, by
  `hostedObjects(written).holds` - an object edited again during the save
  waits, and one its station stores a few micrometres off counts as
  written),
  `finished` (the caller's own entries that left, so a photo's bytes
  travel with them), `deleted` (the deletions not applied). Pure.
- `finishedFileName(tour)` (M6 E2a) - the name a finished tour is saved
  under: the hosted file's own (Drive offers "Replace" only for the same
  name), made safe where a download would change it
  (`content-disposition.ts`), else the link's file name, else `tour.zip`.
  The phone's Finish and the desktop editor's Save.

## Invariants & assumptions

- **Edits:** records replace theirs by id in place, new ones are appended,
  deleted ones filtered out (`applyObjectChanges`; never an id twice, the
  serializer rejects duplicates). A deleted photo's content file is
  removed (`contentEntriesToRemove`).
- **Assets:** an asset nothing names any more (no step block, no placed
  model, not the cover; `withReferencedAssets` of `tour-content.ts`) leaves the
  written manifest, and its file leaves the zip - unless `keepAssets`
  (the page's undo history, `historyAssetIds`) names it: an undo across
  the save must still find it.
- **Paths:** the manifest at `${manifestWrap}tour.json` (the session's own
  prefix, never derived again); a level the zip holds is replaced where it
  is, a new one inside a listed tour's folder or at the root
  (`finish-entries.ts`); photos at `${wrap}${image}`.
- **Signatures and lists:** a signature never survives (it cannot cover
  the rewritten files); a LISTED tour's `manifest.json` continues as the
  series' next version (`successorManifest`: same series id, the
  version the tour was OPENED with + 1 - a rebuild chained on `previous`
  stays there, so one page load mints one version however often it
  saves; a reload of the written file bumps again,
  every file's hash - the kept ones from the input's list or
  `previous.signedManifest`, the written ones hashed here). An unlisted
  tour carrying the name drops it.
- **The walk:** entries visitors never read are left out unless
  `keepScan`: a visitor never reads the walk.
- **Newest bytes:** `previous.blob` when given, else
  (null or omitted, one expression for both the read and the budget)
  `tour.readWholeArchive()` - rebuilding from the hosted zip again would
  drop the previous batch's content files (PR #435 review). The hosted
  zip is untrusted and inflates under `tour.budget`; a previous rebuild is
  the page's own output and gets the rebuild's default budget.
- Page-free: no DOM, no store, no clock unless `now` is omitted.

## Examples

```ts
const finished = await rebuildFinishedTour({
  tour: session,
  manifest: openedManifest ?? createEmptyTourManifest(), // as read at open
  placed: [{ object: editedPin }],
  deleted: ["photo-1"],
  levels: [],
  keepScan: false,
  previous: null,
});
if (finished !== null) save(finished.blob);
```

## Tests

`finish-rebuild.test.ts` on real zips: the edits (in place, appended, a
deleted photo's file removed, the level replaced inside the wrap), an
asset nothing uses dropped from the manifest and the zip while a step's
asset and the cover stay, a placed model's file kept while a model asset
nothing names is dropped, the
title rule, a listed tour's series continued (reopened: listed, next
version, whole-archive check passes), the previous rebuild as input (no
read), `shouldContinue` stopping before the rebuild, the walk left out
with spots and kept with `keepScan` or without spots, a walk that places
nothing left out without spots and kept with `keepScan`, a signed tour's
signature dropped, the hosted zip under the budget (also with `previous`
omitted) and a previous rebuild without it, and a chained rebuild of a
listed tour staying at the open-time version + 1. Every check reads the
zip's bytes (`tour.json`, the level), never only the returned
`written`. The same file pins `pendingAfterRebuild` (an edit made during the save
waits, a placement waits, only applied deletions clear, the caller's
objects come back, a stored copy micrometres off counts as written), and
the walk left out unless kept.
`finish-rebuild.property.test.ts` sweeps mixes of edits,
additions and deletions: each id once, edits in place, a deleted
photo's file gone, kept ones present, the zip opens again. The phone's
wiring around it stays pinned by `creator-finish.test.ts` and
`authoring-settle.test.ts`.
