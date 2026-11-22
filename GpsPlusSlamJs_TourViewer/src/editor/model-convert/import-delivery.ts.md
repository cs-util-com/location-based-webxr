# import-delivery.ts

**Purpose:** where a converted model goes once the runner (`model-import-runner.ts`) made it: into the tour's files, then where its drop was made.

## Public API

- `importDelivery(target, deps)`: an `ImportDelivery` for a drop at `target` (a `FileDropTarget` of `file-drop.ts`, or null for a drop on no row and for "Add files..."):
  - the model is added with `deps.addFile`; a refusal resolves `refused` with its words (an unforeseen error as `FILE_ADD_FAILED`), so the runner fails its row with them;
  - then `deps.shelved(id, name, notes)` for no target (`notes`: the count of the conversion's notes, read on the model's card), else `deps.use(target, id, name)` (an item's file field, a station's or a story's row: the page makes the one step and says it, a refusal there included, the model then staying on the shelf);
  - `deps.notKept()` when the draft could not keep a copy;
  - resolves `added { id }` (the shelf entry's id), or `stopped` when the tour the drop was made in closed before or while the model was added.
- `ImportDeliveryDeps`: `open`, `addFile`, `use`, `shelved`, `notKept`, lent by `edit-main.ts`.

## Invariants

- The model is in the tour's files before it is used anywhere: a use the tour refuses leaves it on the shelf, said, never lost.
- Nothing is added once the tour closed: a converted model never reaches the next tour opened.

## Tests

`import-delivery.test.ts`: each target, the not-kept warning, a refusal and an error, a tour closed before and during the add.
