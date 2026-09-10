# authoring-draft.ts

## Purpose

The RULES about a crash-safe authoring draft (second testing session,
F13): what restoring one adds, when it is spent, and what the creator is
asked. Pure - the OPFS mechanics are the framework's
(`opfs-draft-store.ts`) and the on-disk shape is `draft-persistence.ts`.

## Public API

- `AuthoringDraft` - `{ tourUrl, sizeM, level, objects }`.
- `draftKeyForTour(tourUrl) -> string`.
- `draftObjectsNotYetHosted(draft, manifest) -> readonly TourObject[]` -
  the whole state machine in one function; see the invariants.
- `draftIsSpent(draft, manifest) -> boolean`.
- `appendWithoutDuplicateIds(existing, additions) -> TourObject[]` - what
  the finish uses to merge a restored draft.
- `restoreOfferText(count)`, `restoredText(count)` - the creator's words.

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
- **Nothing already in the manifest is ever restored.**
  `serializeTourManifest` rejects duplicate ids, so re-appending one does
  not corrupt `tour.json`: it makes every finish THROW, for as long as the
  draft is restored, and the app's only escape would be clearing the site's
  storage. `appendWithoutDuplicateIds` is the second line of that defence.
- **"Spent" is the only staleness this design acts on**: the hosted
  manifest already carries every object the draft holds. That is proof the
  content reached the file the world sees. A download tap is NOT proof - on
  Android the save resolves true the moment a download starts, and the
  creator still has to upload it by hand afterwards.
  - A draft made against a hosted zip that changed underneath is a real
    hazard this does not detect. Carried knowingly rather than guessed at.
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
silent. Plus: an absent manifest restoring everything, the spent rule, the
dedupe's no-duplicate property with stable order, the key's identity, and
the counts in the copy.
