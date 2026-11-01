# long-text-writer.ts

## Purpose

The long text's writer in the 3D view's inspector, as the "in the
inspector" prototype has it
(`public/prototypes/longtext-editor-1-in-the-inspector/`): the view
picker, a plain text area over a mirror that dims the marks, a
formatting toolbar with its shortcuts, the parts shown as typed
(underlined, counted in a chip, listed by line, explained in a callout
at the cursor) and the spot the narration takes in the next step. The
body stays the tour's Markdown; a creator never needs to know it.

## Public API

- `WRITER_SAVE_MS` = 700 - the pause in typing before the text is
  written.
- `createLongTextWriter(deps)` -> `LongTextWriter`:
  - deps: `document`, `kept` (`kept-store.ts`), `writeBody(blockId,
body)` and `writeView(blockId, view)` (each one undo step of the
    tour, `"written" | "refused"`), `loadPicture(path)`, `say(text)`,
    `onText?(body)` (each change, for the preview), `onShow?(from, to,
body)` (a part gone to: the preview flashes it), `createUrl?`,
    `revokeUrl?`;
  - `node` - its root, the same across draws;
  - `area` - the text area;
  - `update(model | null)` - the inspector's long text
    (`InspectorLongText`); another text writes the typing of the first
    and starts afresh; the same text with another body from outside
    (the tour's undo) is shown;
  - `flush()` - typing not yet written is written now;
  - `destroy()`.

## Behaviour

- Toolbar: heading, subheading, bold, italic, bulleted and numbered list,
  outdent, indent, link (a row for the address), picture (the tour's
  pictures, its file name's words as the description, selected to type
  over), help. Their mousedown is prevented, so the selection stays in
  the text.
- Keys in the text: Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+Shift+8, Ctrl+Shift+7;
  Enter continues a list (an empty item ends it); Tab and Shift+Tab move
  list lines in and out, elsewhere Tab leaves; Esc closes a popover, and
  Esc then Tab always leaves the writer.
- Every edit goes through `execCommand("insertText")` where the browser
  has it (Ctrl+Z undoes it like typing), else `setRangeText` and an
  `input` event.
- Saving: "Saving..." while typing pauses, "Saved" once the tour took the
  text, "Not saved" when it refused it (over its cap; the page says why).
  An emptied text is written only when the writer is left (blur, another
  selection, hide), since the tour refuses it.
- The tour stores a text trimmed: a text differing only in the spaces
  around it counts as the same, so a space typed at the end is never
  taken away by the store's answer.
- Parts shown as typed: `typedParts` with the tour's pictures; the
  callout offers "Make it plain text" (a kind's own fix label), "Use a
  tour picture" (picture kinds, with pictures in the tour) and "Keep as
  typed"; prev and next go through the parts and call `onShow`.
- View picker: radio segments with a roving tab stop; arrows choose and
  focus; a dimmed segment explains why, and Captions without a voice
  offers "Add a narration", which opens and focuses the narration spot
  (its content is the next step's).

## Invariants & assumptions

- Only writing changes the text: typing, the toolbar, its keys, Enter
  and Tab in a list, a link or picture put in, "Make it plain text" and
  "Use a tour picture". The view picker, keeping a part, the chip, the
  list, the help, popovers opened or cancelled, the narration spot and
  the preview never do (invariant test).
- Its controls carry `data-lw`, never `data-act` or `data-field`: the
  shell's own handlers leave them alone (`editor-shell.ts` commits only
  fields drawn under a name).
- Text in the DOM is set with `textContent` only.

## Styling

`long-text-editor.css` (linked in `edit.html`), with the prototype's
numbers under `lw-` classes on the shell's `--s-` tokens; the design
system zeroes margins, so every gap is set there.

## Tests

- `long-text-writer.test.ts` (jsdom): the save line's states for a
  written and a refused text, the trimmed store, the toolbar and keys,
  the parts, the view picker, and the invariant.
- The layout in a browser: `playwright-tests/editor3d-long-text.spec.js`.

## Narration section

The writer's Narration fold holds `createNarrationSection` (`../narration/narration-section.ts`), updated with the block, its body and `narrationKey`; the section's summary and tone go on the fold's head (`sum ok` / `sum amber`). Quotes are cut with the package's one `truncated` helper (`../truncated.ts`).
