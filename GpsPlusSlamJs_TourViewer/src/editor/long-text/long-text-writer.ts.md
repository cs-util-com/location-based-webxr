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
    (the tour's undo) is shown; `null` writes the typing and lets the
    picture thumbnails go;
  - `flush()` - typing not yet written is written now (the page calls it
    through the shell before a save);
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
  Esc then Tab (or Shift+Tab) always leaves the writer: a modifier's own
  keydown between them keeps the Esc. Esc stays in the writer (stopped:
  the page's Esc would deselect the item), and every key while an input
  method composes is the method's (its Esc ends the composition; it
  neither leaves nor reaches the page).
- Every edit goes through `execCommand("insertText")` where the browser
  has it (Ctrl+Z undoes it like typing), else `setRangeText` and an
  `input` event.
- Saving: "Saving..." while typing pauses, "Saved" once the tour took the
  text, "Not saved" when it refused it (over its cap; the page says why).
  An emptied text is written only when the writer is left (blur, another
  selection, hide), since the tour refuses it.
- One form of the text (`norm`): NFC (as every field, `input-text.ts`),
  plain line ends, trimmed (the tour stores it so). The writer writes it,
  keeps the tour's text in it and compares in it: a text differing only
  in the spaces around it, its line ends or its Unicode form counts as
  the same, so a space typed at the end is never taken away by the
  store's answer, and a text only selected and left is never written.
- The cap: from 90 % of the format's 32,000 (`TOUR_BLOCK_TEXT_RULES`,
  UTF-16 units of the normalized text) the stat line adds "N of 32,000".
  A text the tour refused is kept per block in memory and shown again,
  "Not saved", when its block is selected again, until it is written or
  the tour's own text for that block changes (an undo, another tour).
  An emptied (whitespace-only) text is never kept: the tour refuses it,
  and coming back shows the tour's text again.
- Picture thumbnails are blob addresses kept by the picture's path; they
  are released when the writer is emptied and when the tour's pictures
  change (their ids or paths; a picture given another file is read
  again). A picture read that lands after a release is not kept, so no
  blob address outlives the release that should free it.
- Parts shown as typed: `typedParts` with the tour's pictures; the
  callout offers "Make it plain text" (a kind's own fix label), "Use a
  tour picture" (picture kinds, with pictures in the tour) and "Keep as
  typed"; prev and next go through the parts and call `onShow`.
- The formatting toolbar is one tab stop (the last focused button); the
  arrow keys move along it, wrapping, and Home and End go to its ends.
  The parts chip names the list it opens (`aria-controls`).
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

The writer's Narration fold holds `createNarrationSection` (`../narration/narration-section.ts`), updated with the block, its body and `narrationKey`; the section's summary and tone go on the fold's head (`sum ok` / `sum amber`). Quotes are cut with the package's one `truncated` helper (`../../truncated.ts`). Without narration deps (a page that offers none) the fold says "A narration cannot be added on this page."
