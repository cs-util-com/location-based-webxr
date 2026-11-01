# narration-section.ts

## Purpose

The long text's Narration section in the writer, as the "in the inspector" prototype draws it (`public/prototypes/longtext-editor-1-in-the-inspector/`): the voice, the timing import, the status line on the section's head, the stale explanation with "Line the voice up again", and the card saying what an import or a lining up did.

## Public API

- `createNarrationSection(deps): NarrationSection`
  - `deps.read(blockId)` gives the text's `NarrationFacts` (`EditorSession.narration`), or a refusal drawn as a note.
  - `deps.edit(blockId, change)` writes one `NarrationChange` (`EditorSession.editNarration`) and answers `"written"` or `"refused"`; the page says a refusal.
  - `deps.say(text)` is the page's toast; `deps.onSummary(summary, tone)` puts the status on the head; `deps.onShow(from, to, plain)` shows a stretch of the PLAIN text (`plainTextOf`), whose offsets a timing counts in.
  - `deps.durationOf(file)` reads a voice's length (default: an `<audio>` element's metadata, 5 s at most, unknown on failure).
- `section.update({ blockId, body, key } | null)` follows the selected text. A new `key` (the inspector's `narrationKey`: the narration record plus a stamp of the tour's timings) or a new body re-reads; another block also forgets the last result and the import error.
- `section.takeFiles(files)` takes chosen or dropped files: a sound file is the voice, a `.vtt` / `.json` / `.txt` file a timing.
- `section.settled()` settles once the reads asked for so far are drawn (for tests).
- A timing file over 20 MB (`TIMING_FILE_MAX_BYTES`, module-private) is refused before it is read.

## Invariants

- One action runs at a time. While it runs, its button carries the running words ("Adding the voice...", "Importing...", "Lining up...", "Removing..."), every action button is disabled, and the section is `aria-busy`. Once it ends, the section re-reads and draws what the tour holds.
- A timing file that does not read (`TimingFileError`), is over 20 MB, or has nothing of the text in it is never written. The `.ln-err` box (`role="alert"`) names the file and says the text and the current timing are unchanged, and the toast says it too.
- A timing is written as compact JSON (`JSON.stringify` of the `TourTiming`), since the format's cap counts bytes.
- A timing can only be imported once there is a voice. Removing the voice removes the timing with it (the session's rule), and one undo brings both back.
- Reads are numbered, so a read landing late after a newer one draws nothing.

## Examples

```ts
const section = createNarrationSection({
  document,
  read,
  edit,
  say,
  onSummary,
});
section.update({ blockId: "essay", body, key: model.narrationKey });
await section.takeFiles([new File([vtt], "voice.vtt")]);
```

## Tests

`narration-section.test.ts` (jsdom), against a fake session that holds the facts:

- adding a voice, with its running state, and a refused voice that reverts;
- a file of neither kind;
- an import (running state, compact JSON, the result card and folding it away);
- a malformed file that never reaches the tour;
- a refused import;
- the stale notice and its Show link, given plain-text offsets;
- lining up again, its running state, and a refusal that keeps the notice;
- following the selection.
