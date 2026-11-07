# inspector-contents.ts

## Purpose

A station's Contents in the inspector: its items as rows, a press selecting
one. On a phone the tree is out of sight while the details show, so this is
the way on from a station to what it holds.

## Public API

- `contentsSummary(count)` - the fold's summary, "1 item" or "3 items".
- `contentsBody(items, add)` -> elements: `.kids` of `button.kid`
  (`data-act="goto:<id>"`, `.ic <kind>`, `.nm`), or a note that the station
  holds nothing; then `add`, then a note on the other ways to add.

## Invariants & assumptions

- Text only, set through `textContent`; a title is never markup.
- The shell answers `goto:<id>`; this file knows no store.

## Examples

```ts
disclosure("Contents", contentsSummary(items.length), true, {
  act: "contents",
  body: contentsBody(items, addButton),
});
```

## Tests

`shell-inspector.test.ts` ("a station's Contents"): the rows, the empty
station, the fold, an item's details without it. `editor-shell.test.ts`: a
press selects and flies.
