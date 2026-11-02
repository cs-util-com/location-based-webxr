# kept-store.ts

## Purpose

The parts of each long text a creator chose to keep as typed ("Keep as
typed"), remembered in this browser. The tour format has no field for
this choice and the editor adds none: the choice only quiets the
writer's underline and count, and the text itself never changes.

## Public API

- `KEPT_STORAGE_KEY` = `"tour-viewer.editor.kept-as-typed.v1"`.
- `KEPT_PER_TEXT_MAX` = 200 keys per text.
- `createKeptStore(storage = localStorage)` -> `KeptStore`:
  - `get(blockId)` - the kept keys (a copy);
  - `set(blockId, key, kept)` - keeps or stops keeping one.

## Invariants & assumptions

- Storage that throws or is missing (a private window) falls back to
  memory for the page's life; a stored value that is no JSON object of
  string arrays reads as empty.
- A text's keys are capped (`KEPT_PER_TEXT_MAX`); the oldest go first.
- Per browser, never in the tour: another device shows the parts again.

## Tests

- `kept-store.test.ts` - keep, unkeep, a broken store, the cap, a
  throwing storage.
