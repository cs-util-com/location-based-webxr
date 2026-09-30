# authoring-draft.ts

## Purpose

The RULES about a crash-safe authoring draft (second testing session,
F13): what restoring one adds, when it is spent, and what the creator is
asked. Pure - the OPFS mechanics are the framework's
(`opfs-draft-store.ts`) and the on-disk shape is `draft-persistence.ts`.

## Public API

- `AuthoringDraft` - `{ tourUrl, sizeM, level, objects, deleted }`;
  `deleted` holds the ids deleted on this device (tombstones, authoring
  plan 2026-09-28-0953 §3.4, M4).
- `draftKeyForTour(tourUrl) -> string`.
- `draftObjectsNotYetHosted(draft, manifest) -> readonly TourObject[]` -
  the whole state machine in one function; see the invariants. Compares
  CONTENT (`objectContentKey`), not ids.
- `draftDeletionsNotYetHosted(draft, manifest) -> readonly string[]` - the
  tombstones whose id the hosted manifest still carries.
- `objectContentKey(object) -> string` - an object's JSON with every key
  sorted: one comparable string whatever order its fields were written in.
- `draftIsSpent(draft, manifest, hostedLevelJson) -> boolean`.
- `applyObjectChanges(existing, changes, deleted) -> TourObject[]` - what
  the Finish writes: `existing` with each change REPLACING the record with
  its id, the rest of `changes` appended, every deleted id filtered out.
- `contentEntriesToRemove(existing, deleted, wrap) -> string[]` - the zip
  paths of deleted photos' content files, for the rebuild's removal list.
- `restoreOfferText(count, hasLevel, { changed, deleted })`,
  `restoredText(count, hasLevel, { changed, deleted })` - the creator's
  words; changes and deletions are named apart from new placements.

## Invariants & assumptions

- **A draft is "everything placed since the HOSTED zip last had it", not
  "since the last finish".** This is the rule the milestone's cold review
  turned on. Finishing is not terminal: it merges the placed objects into
  the in-memory manifest, empties the list, and leaves that batch alive
  only inside `ctx.rebuiltZip`, a Blob that dies with the page. A draft
  reset by each finish would hold only what was placed AFTER the last
  download, while the finish rebuilds from the hosted zip, which never had
  the earlier ones - two downloads, each missing the other's content, and
  nothing on screen saying so.
- **Nothing the manifest already carries - with the same content - is ever
  restored.** `serializeTourManifest` rejects duplicate ids, so
  re-appending one does not corrupt `tour.json`: it makes every finish
  THROW, for as long as the draft is restored, and the app's only escape
  would be clearing the site's storage. `applyObjectChanges` is the second
  line of that defence: it replaces by id and never writes an id twice.
- **Content, not ids** (plan §3.4, cold review #8): an edit or a move of a
  hosted object keeps its id, so an id comparison called it "already in
  the zip" - never offered, and deleted as spent. `objectContentKey` sorts
  keys because a record read from disk and one minted in memory carry
  their fields in different orders.
- **A deletion is work until the hosted zip lacks the id**: a draft holding
  only a pending deletion is not spent, and restoring it brings back the
  tombstone, never the object.
- **The Finish replaces and filters** (`applyObjectChanges`): hosted order
  is kept, a deleted id never comes back whatever the changes hold, and no
  id is written twice (property tests).
- **"Spent" is the only staleness this design acts on**: the hosted
  manifest already carries every object the draft holds. That is proof the
  content reached the file the world sees. A download tap is NOT proof - on
  Android the save resolves true the moment a download starts, and the
  creator still has to upload it by hand afterwards.
  - A draft made against a hosted zip that changed underneath is a real
    hazard this does not detect. Carried knowingly rather than guessed at.
- **The settle rewrites records in place, and changes no shape**
  (authoring plan 2026-09-28-0953 §3.2, M2c): at a visit's end (and at
  Finish for a running visit) `creator-setup.ts` writes each settled object's
  record again under its id and the meta with the re-minted level. The same
  ids, the same fields - only the geo is newer - so neither the spent rule
  nor `applyObjectChanges` sees anything new, and a page reload
  restores the SETTLED geo. A tab killed before the settle keeps the
  tap-time geo (accepted in the plan); the odometry pose behind it is not
  stored, because another visit's odometry is meaningless.
- **`sizeM` is part of the draft** because a crash loses it:
  `creator-setup.ts` rewrites the printed-size field from the framework
  default on every load, so a creator who printed at 20 cm would re-enter
  AR solving against 16 - silently, because the restored level's own copy
  of the size still looks right.
- **The key is the CREATOR-FACING url**, the same string `wizardStepKey`
  uses - never `session.archive.url`, which is normalised: a Drive tour's
  proxy route is a relative path on a deployment and an absolute one on a
  dev host, so one tour would key two ways.

## Tests

`authoring-draft.test.ts`. The property that carries it is "never returns
anything the manifest already has", because that failure is permanent and
silent. Plus: an absent manifest restoring everything, an edit of a hosted
object counted as not hosted and field order ignored, pending deletions
and the spent rule, `applyObjectChanges` (replace, append, filter) with a
property that no deleted id comes back and no id is written twice,
`contentEntriesToRemove`, the key's identity, and the counts in the copy
(changes and deletions named).
