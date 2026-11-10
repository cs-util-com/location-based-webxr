# shelf-page-actions.ts

## Purpose

The page's side of the shelf's commands: "Add files...", the delete of a
file in use and "Replace everywhere". Each shows a busy toast while it reads,
says its outcome, says a failure, and leaves nothing half done. The page
(`edit-main.ts`) hands in its toasts, pickers and Undo offer; the session
(`editor-session.ts`) makes the edits.

## Public API

- `createShelfPageActions(deps: ShelfPageDeps): ShelfPageActions`
  - `addFiles(open)`: `pickMany`, then `addToShelf`. A picker that rejects
    is said as `FILE_ADD_FAILED`.
  - `addToShelf(open, files)`: a busy toast (`shelf-add-busy`) while each
    file goes through `open.addFile`. A refusal is said per file as
    `<name>: <reason>`, and a throw as `<name>: FILE_ADD_FAILED`. Then the
    last file added is revealed, a toast says how many arrived, and
    `FILE_NOT_KEPT` is said when the draft could not keep one of them.
  - `deleteInUse(open, id)`: ends any open Undo offer, then
    `deleteFileAndUses`.
    - A delete that made no step (the session hands back the card's own
      `undo`, because nothing used the file after all) is said as
      "Deleted <name>." with that Undo on the toast, as the plain delete
      of an unused file offers it.
    - Every other outcome goes through `deps.deleted`: the page's Undo, or
      the refusal said.
  - `replaceEverywhere(open, id)`:
    - before any picker, a file no longer on the shelf is said as
      `NOT_ON_SHELF`;
    - then a picker of the old file's kind; a picker that rejects is said as
      `FILE_ADD_FAILED`;
    - while the new file is read, a busy toast (`replace-everywhere-busy`);
    - a throw is said as `FILE_ADD_FAILED`, a refusal in its own words;
    - success is offered with the Undo as `"<name>" is used in N place(s)
now.`, plus `FILE_NOT_KEPT` when the file could not be kept.
- `NOT_ON_SHELF`, `ShelfPageDeps`, `ShelfPageSession` (the slice of the
  session these commands use), `ShelfPageActions`.

## Invariants

- Never rejects. Every busy toast is removed on every outcome (`finally`).
- Once another tour is open (`deps.current() !== open`), nothing more is
  said or revealed.
- A delete that made no step never goes through the page's Undo offer
  (the edit stack's: tapping it would take back an older change); its
  toast carries the card's own Undo instead.

## Tests

`shelf-page-actions.test.ts` uses fake deps and a fake session. It covers
the busy toasts, the failure toasts, the refusals, the not-kept warning and
both delete branches. Each branch was broken once by hand to prove that its
test fails.
