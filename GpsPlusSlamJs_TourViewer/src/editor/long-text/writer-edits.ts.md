# writer-edits.ts

## Purpose

The long text writer's editing commands, pure: each takes the text and
the selection and returns the one replacement that writes the marks the
tour's reader formats (`**bold**`, `*italic*`, `## Heading`, `- list`,
`1. list`, `[words](https://...)`, a picture line). The writer
(`long-text-writer.ts`) applies a replacement through the browser's own
editing, so Ctrl+Z undoes it like typing.

## Public API

- `WriterEdit { from, to, text, select }` - replace `[from, to)` by
  `text`; `select` is the selection afterwards, counted from `from`
  (null: the caret after the text).
- `LIST_LINE` - a list line's indent and mark (`-`, `*`, `+`, `1.`,
  `1)`).
- `lineRange(value, start, end)` - the whole lines a selection touches.
- `touchesList(value, start, end)` - whether one of them is a list line.
- `wrapInline(value, start, end, "**" | "*")` - wraps the selected words
  (spaces around them left outside), unwraps words already wrapped, and
  puts an empty pair at a bare caret with the caret between. Over a blank
  line each paragraph is wrapped (or, when each already is, unwrapped) on
  its own: the reader formats marks only inside one paragraph.
- `toggleList(value, start, end, "bullet" | "number")` - makes the lines a
  list, numbered from 1, or plain again when they already are that list;
  null for no lines.
- `toggleHeading(value, start, end, 2 | 3)` - the lines a heading or a
  subheading, or plain again.
- `indentLines(value, start, end, "in" | "out")` - list lines in or out
  by two spaces; null when no line is a list line (or none can move).
- `continueList(value, caret)` - Enter in a list line: the next mark
  (the number counted on); on an empty list line, the mark removed (the
  list ends); null outside a list.
- `insertBlock(value, caret, text)` - `text` on a line of its own at the
  caret, blank lines kept around it.
- `linkTarget(typed)` - a typed address as a link's target (`https://`
  added to a bare domain), null for one that is no web address; spaces
  and angle brackets inside it escaped (`%20`, `%3C`, `%3E`).
- `linkEdit(value, start, end, typed)` - the selected words as a link, or
  the address shown as its own words; null for no address. Line breaks in
  the words become spaces and their brackets are escaped (`[`, `]`),
  so the link stays one link.
- `applied(value, edit)` - the text and the selection after `edit`.

## Invariants & assumptions

- Pure and total: positions are clamped into the text, a bad selection
  gives a caret.
- Every command keeps every letter of the text; only marks and white
  space change (the property tests).
- Line ends are `\n` (a text area's).

## Examples

```ts
const e = wrapInline("an old gate", 3, 6, "**");
applied("an old gate", e); // { value: "an **old** gate", selection: [5, 8] }
```

## Tests

- `writer-edits.test.ts` - each command, by example.
- `writer-edits.property.test.ts` - words kept by every command, list
  continuation by any list line, toggles undone by toggling again.
