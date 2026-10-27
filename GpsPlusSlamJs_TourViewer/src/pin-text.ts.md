# pin-text.ts

## Purpose

A pin's text as both creator pages take it - the phone's "Place a pin"
field and object edit, and the desktop editor's new pin and inspector: at
most 40 characters, counted the way the tour file counts them, with a
counter beside the field.

## Public API

- `PIN_TEXT_MAX_CHARS` - 40, the short text caption's cap
  (`TOUR_BLOCK_TEXT_RULES.shortText.caption.max`, framework
  `ar/tour-blocks`).
- `PIN_TEXT_TOO_LONG` - the sentence a page shows when it refuses a text
  past the cap.
- `pinTextCount(text): number` - the format's count (`tourTextCount`):
  code points after trimming and collapsing each whitespace run to one
  space.
- `pinTextTooLong(text): boolean` - the count is past the cap.
- `pinTextCounterLine(text): string` - `"12 / 40"`.
- `wirePinTextCounter(field, out): { update() }` - shows the count in
  `out` at once and on every `input`, with a `data-over` attribute while
  the text is too long; `update()` after the page sets the value itself.
- `textCounterLine(text, max)` / `wireTextCounter(field, out, max)` -
  the same for any text against its cap `max`, by the same count (the
  editor inspector's block fields, `editor/block-fields.ts`, B2c); the
  pin's two are these with `PIN_TEXT_MAX_CHARS`.

## Invariants & assumptions

- **One count everywhere.** The counter, the refusal and the file's reader
  use the framework's `tourTextCount`, so a text the counter shows as 40
  is one the writer accepts.
- **No `maxlength`.** It counts UTF-16 units: an emoji is two, so a field
  capped at 40 would stop at 20 emoji. The counter shows the count and the
  page refuses a text past it (`object-edits.ts` `pinTextEdit`, the
  phone's pin save), leaving the pin as it was.
- The field and output are structural, so the tests run in node.

## Examples

```ts
wirePinTextCounter(input, counterOutput);
if (pinTextTooLong(input.value)) showRefusal(PIN_TEXT_TOO_LONG);
```

## Tests

- `pin-text.test.ts` - the cap is the format's 40; code points, not UTF-16
  units (40 emoji fit, 41 do not); whitespace collapsed; the counter's
  line; any text counted exactly as the format counts it (property); the
  wired counter at once, while typing and on `update()`, marked while
  over.
