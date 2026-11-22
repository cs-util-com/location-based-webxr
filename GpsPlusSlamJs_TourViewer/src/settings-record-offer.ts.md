# settings-record-offer.ts

## Purpose

One rule for both pages' drafts on what a stored settings record
(`tour-document-draft.ts`'s `TourSettingsRecord`) offers against the
opened tour and what its restore puts back. The desktop editor
(`editor/editor-draft.ts` builds the offer, `editor/editor-session.ts`
restores it) and the phone (`creator-draft.ts`) both call it, so a record
written on one page is offered and restored whole on the other - the
setting, the details, the station poses, a station's own fields, the
order, the deleted and the created stations, and the characters. The
pages keep their own words around it and their own stores.

## Public API

- `settingsOf(manifest)` - a tour's own settings in the record's shape:
  what a record is compared with.
- `changesSettings(wanted, against)` - whether `wanted` changes the
  setting, a detail, a station's pose, a station beyond its pose (its
  fields, an added or a deleted station, the order) or the characters.
- `addsStations(wanted, against)` - whether `wanted` holds a station the
  page created that `against` lacks: work only beside objects that name
  it.
- `differs(wanted, against)` - either of the two.
- `heldAgainst(settings, manifest)` - a recorded cover that names no image
  of `manifest` (a photo deleted since) replaced by the tour's own cover.
- `settingsChanges(settings, manifest)` -> `SettingsChanges` (`noGps`,
  `details`, `stations`, `frames: FrameChanges`, `characters`), and
  `settingsChangeCount(changes)` - how many changes an offer counts: the
  setting, each detail and station one, the characters by declaration.
- `settingsParts(changes, noGps)` - the offer's named parts in the pages'
  order (`noGps` names the setting; the phone passes `""`, it never
  offers it), and `joinedParts(parts)` - "a, b, and c".
- `changedDetails`, `frameChangeCount`, `DetailField`, `FrameChanges` -
  the pieces the desktop's words use.
- `movedIds(settings, manifest)` - the items a recorded frame moves
  between a story and the free items: their records belong to that
  frame's change, never counted on their own.
- `restoreWithSettings(state, base, settings)` -> `{ work, withObjects }`
  - `work` is the `TourRestore` the slice's `restored` takes: `base`'s
    objects, deletions and assets, the poses that differ from `state`'s,
    the created and hand-made stations, frames, order, deleted stations,
    characters, the setting when it differs, and the details as the details
    form checks them (a cover may name a photo the objects bring back).
    `withObjects` is `state` with the work applied but for the setting and
    the details: what a page counts its restored station edits against.

## Invariants & assumptions

- Pure functions over plain records; no store, no I/O, no DOM.
- A record without a part (an older version's, or nothing changed) leaves
  that part of the tour as it is: absent fields are never "empty".
- The record has no base: a detail or frame recorded here and changed
  since elsewhere is put back as recorded. The offer names every part it
  would change, so the creator decides with that in view.
- The phone never edits the "no GPS" setting; it reads a record's copy as
  the opened tour's before it compares (`creator-draft.ts.md`).

## Examples

```ts
const file = settingsOf(manifest);
const held = heldAgainst(record, manifest);
const offered =
  changesSettings(held, file) || (objects > 0 && addsStations(held, file));
const words = joinedParts(settingsParts(settingsChanges(held, manifest), ""));
const { work } = restoreWithSettings(state, { objects, deleted }, held);
store.dispatch(
  tourDocumentActions.restored({ ...work, what: "the restored draft" }),
);
```

## Tests

- `draft-shared-behaviour.test.ts` runs every settings row on both pages
  through their real draft paths (details, a station's own fields, the
  order, deleted stations, characters, a rename beside an object change).
- `editor/editor-draft.test.ts` and `editor/editor-session*.test.ts` pin
  the desktop's words and restores; `tour-document-draft*.test.ts` the
  record's read and write.
