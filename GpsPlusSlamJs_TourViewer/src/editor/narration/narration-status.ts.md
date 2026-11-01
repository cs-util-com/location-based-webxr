# narration-status.ts

## Purpose

The Narration section's words, page-free: the line on its head ("Reads along, 2:41"), the stale explanation's list of what no longer lines up, and the cards an import or a lining up again leaves. The section (`narration-section.ts`) draws them; this module only computes them.

## Public API

- `narrationStatus(body, facts, lang?)`: the section's state for a long text's markdown `body` and its `NarrationFacts` (`hasVoice`, `durationMs`, `timingText`). One of: no voice; a voice without timing; a timing that does not read (`problem`); a timing that runs past the voice (`problem`); a timing the text moved away from (`stale: { count, items }`); or one that reads along (`unvoiced` notes for the sentences no segment starts in). `summary` and `tone` (`""`, `"ok"`, `"amber"`) feed the section's head. Never throws.
- `staleNotes(timing, P, sentences)` (module-private, behind `narrationStatus`): why `timing` no longer fits the plain text `P`, read as a lining up again would (`reAnchorSegments`).
  - A voiced sentence whose words changed, or that has words no segment covers (words added beside the voiced ones), is one `changed` note.
  - A sentence the voice does not reach is `rewritten` when a lost part of the voice stood where it stands, else `new`.
  - A lost part with no sentence in its place is `taken-out`.
  - Notes carry plain-text offsets `from` / `to` for the Show link (null for a taken-out part).
- `changeWords(was, now)`: `you changed "a" to "b"`, `you added "..."`, `you took out "..."` or `you changed a few words`.
- `importResult(fileName, done)`: the card after an import (`TimingImport`): how many lines (or words) matched, each mismatch listed under its file label (`Line N of the file`, the line number in the file itself), the sentences with no voice, and the parts of the file that could not be read. `partial` marks a card with anything listed.
- `lineUpResult(done)`: the card after "Line the voice up again" (`LinedUpAgain`).
- `plural(n, one, many?)`.

## Invariants & assumptions

- All offsets count in the plain text `plainTextOf(parseTourMarkdown(body)).text`, as a timing's do.
- A timing is stale when `tourTimingStaleReason` says so (the text's hash or length differs). A stale status with no note is still stale: its summary reads "Needs lining up", and the section says the voice no longer lines up with the text.
- A damaged timing text is a `problem`, never an exception.
- Quotes are cut at 40 characters (`truncated`).

## Examples

```ts
const status = await narrationStatus(body, {
  hasVoice: true,
  durationMs: 6000,
  timingText,
});
if (status.stale !== null) list(status.stale.items);
```

## Tests

`narration-status.test.ts`: the word for one and many, the change words, every state of `narrationStatus` (no voice, no timing, reads along with its length, unvoiced notes, damaged, past the voice, a changed word, words added beside voiced ones, new / rewritten / taken-out sentences, another text's timing never throwing), and the import and lining-up cards.
