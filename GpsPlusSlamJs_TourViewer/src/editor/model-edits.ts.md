# model-edits.ts

## Purpose

A 3D model block's own edits in the editor, pure: its world view, its
notes (`annotations`), its cutaway's sections and its animation clip,
each held to the tour format's caps (`gps-plus-slam-app-framework/ar/tour-blocks`)
and to the editor's default view rule.

## Public API

- `ModelSpot` - `{ position, normal }`, two vectors in the model file's own
  space (`TourModelVector`), as a click on the drawn model gives them
  (`editor3d-model-parts.ts`).
- `ModelEdit` - one edit:
  - `{ kind: "view", view }` - one of `TOUR_MODEL_WORLD_VIEWS`;
  - `{ kind: "note-add", at }`, `{ kind: "note-text", index, field: "title" | "text", value }`,
    `{ kind: "note-place", index, at }`, `{ kind: "note-delete", index }`;
  - `{ kind: "section-add", at }`, `{ kind: "section-name", index, value }`,
    `{ kind: "section-place", index, at }`, `{ kind: "section-delete", index }`;
  - `{ kind: "animation", name, autoplay }`.
- `applyModelEdit(model, edit, explicitView)` returns a `ModelEditOutcome`:
  - `{ kind: "edited", after, what }` - the model after the edit, and the
    undo step's words ("the new note", "the title of note 2", ...);
  - `{ kind: "unchanged" }` - the edit changes nothing (the same view, the
    same spot);
  - `{ kind: "refused", reason }` - one of `MODEL_EDIT_REFUSALS`, in words a
    creator reads.
- `MODEL_EDIT_REFUSALS` - view, notesFull, sectionsFull, noSuchNote,
  noSuchSection, spot, noteTitle, noteText, sectionName, animationName.
- The guards the edits use (`isModelWorldView`, `isModelSpot`) are module-private.

## Invariants and assumptions

- Every edited model is one the tour's reader takes back unchanged
  (`parseTourObject(tourObjectRecord(m))`): titles 1-64 code points, texts at
  most 1024, section names 1-40, at most `TOUR_MODEL_MAX_NOTES` (32) notes
  and `TOUR_MODEL_MAX_SECTIONS` (4) sections, finite vectors within
  `TOUR_MODEL_SPACE_MAX`, never a normal shorter than
  `TOUR_MODEL_MIN_DIRECTION_LENGTH` (the reader refuses it as zero), never an empty list (the
  last one deleted leaves the field out).
- A new note is named "Note N", a new section "Section N" (N its place in
  the list after the add).
- A blank text removes the note's text; a blank clip name removes the
  animation.
- The default view rule (owner's): a note added to a model in `placed`
  with no notes switches it to `hotspots`; deleting the last note of a
  model in `hotspots` switches it back to `placed`; neither happens when
  `explicitView` is true. The editor session passes true for every model
  except one placed in this session whose view was never touched, so a
  view read from a file is never overridden. Sections never move
  the view.
- Defensive: an index that is no integer in the list, a spot that is not
  three finite numbers twice, or a view the format lacks is refused, never
  thrown.

## Examples

```ts
const out = applyModelEdit(model, { kind: "note-add", at: spot }, false);
if (out.kind === "edited")
  store.dispatch(
    tourDocumentActions.edited({ object: out.after, what: out.what }),
  );
```

## Tests

- `model-edits.test.ts` - the default rule case by case, every refusal with
  its words, the caps at their edges.
- `model-edits.property.test.ts` - arbitrary edit sequences keep the model
  readable and within the caps, its id, asset, size and place untouched; an
  explicit view is never overridden.
- `editor-session-stations.test.ts` - the session's `editModel` writes one
  undo step per edit and keeps the creator's view.
