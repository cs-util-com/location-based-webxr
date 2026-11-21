# `after-edit.ts` - the steps around a typed inspector edit

## Purpose

What the editor page (`edit-main.ts`) does around one typed edit of the
3D inspector, page-free: the delete's Undo offer ended before the write,
the page refreshed after it, a refusal said, a change counted for the
autosave. And the inspector's typed commands, each the write of one
`EditorSession` method through that path.

The same steps are repeated by hand in many other places of the page
(undo and redo, deletes, adds, the details dialog, the narration and the
poster). This module holds the inspector's copy, so its order and its
branches are pinned by unit tests; a later change is meant to make all of
them one listener on the document, and these tests are what it is checked
against.

## Public API

- `SessionWrite` - one write into the open session: `(session) =>` an
  outcome with a `kind`, or `{ kind: "refused", reason }`.
- `TypedEditSteps` - the page's steps: `session()` (null: no tour open),
  `endUndo()`, `refresh()`, `say(text)`, `changed()`.
- `writeTypedEdit(steps, write): TypedEditOutcome`
  - no tour open: `"refused"`, nothing run (not even `endUndo`);
  - else `endUndo`, `write`, `refresh`, then:
    - an outcome carrying a `reason`: `say(reason)`, `"refused"`;
    - kind `"unchanged"`: nothing more, `"written"`;
    - any other kind: `changed()`, `"written"`.
- `InspectorWriteCommands` - the eleven `ShellEditCommands` that are one
  typed write each: `station`, `text`, `block`, `view`, `pictureTag`,
  `pictureViewpoint`, `model`, `groundItems`, `storyTitle`,
  `storyAdvance`, `storyStep`.
- `inspectorWriteCommands(write)` - those commands, each calling `write`
  once with a write of its session method (`editStation`, `editText`,
  `editBlockField`, `editBlockView`, `editPictureTag`,
  `editPictureViewpoint`, `editModel`, `groundItems`, `renameStory`,
  `setStoryAdvance`, `setStoryStep`) with the command's arguments as
  given. `groundItems` returns nothing; the others return `write`'s
  outcome.

## Invariants & assumptions

- A refusal is told apart by its `reason`, not by its kind's name.
- An unchanged outcome counts nothing here; the page's narration and
  poster paths ask the autosave's cap again for it instead
  (`judgeAutosave`). That asymmetry is pinned, not decided.
- The steps are read at call time (the page passes its current session
  through `session()`), so a tour closed between two edits is seen.

## Example

```ts
const outcome = writeTypedEdit(
  { session: () => editor, endUndo, refresh, say: toast, changed: tourChanged },
  (session) => session.editText(id, text),
);
```

## Tests

- `after-edit.test.ts` - the order of the steps per outcome, a property
  over any kind and reason, and each command's session method and
  arguments, and that the command list is exactly these eleven.
