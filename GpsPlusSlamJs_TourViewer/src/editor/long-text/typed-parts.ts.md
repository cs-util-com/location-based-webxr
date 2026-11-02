# typed-parts.ts

## Purpose

The parts of a long text a visitor sees exactly as typed, in the
writer's words: what each one is, why it is not formatted, what "Make it
plain text" does with it, and the replacements of that command and of
"Use a tour picture". Which parts they are comes from the framework's
reader (`diagnoseTourMarkdown` in
`gps-plus-slam-app-framework/ar/tour-markdown`), the same rule the
visitor's sheet formats by, never from a second parser here.

## Public API

- `TYPED_PART_TEXT` - per diagnostic kind: `title`, `headline?`, `why`,
  `fix?` (the fix button's label), `fixNote`, `picture?` (a tour picture
  can stand in).
- `typedParts(body, { assetExists?, kept? })` -> `TypedPart[]`: each
  diagnostic with its `text`, its `key` (`kind:text`, so a part keeps its
  key while the text around it changes) and whether it is `kept`.
- `pictureAlt(part)` - a picture part's description.
- `plainTextEdit(body, part)` -> `PartEdit` - the part's marks taken off
  so its words show as plain text (a table's cells as lines, a code
  box's fences removed, a web picture as its description, an HTML tag's
  angle brackets removed, a refused link as its words - up to the last
  `](`, so words holding brackets of their own stay whole, an entity
  as its sign or, when it cannot be read, as typed, a footnote mark as
  "(note 1)" with no second space after one already there, ...). Never
  removes a word.
- `hasPlainTextFix(body, part)` -> `boolean` - whether that edit changes
  the part at all; false for an entity it cannot read.
- `tourPictureEdit(body, part, assetId, alt?)` - a picture part replaced
  by the tour's picture `asset:<id>`, its description kept.

## Invariants & assumptions

- A non-string body has no parts.
- `plainTextEdit` keeps every word, number and question mark of the
  body (property test). Its result shows no part of the same kind there,
  except for an entity it cannot read, which it leaves as typed (that
  part has no fix: `hasPlainTextFix` is false).
- Kept parts are matched by key only; storing them is
  `kept-store.ts`'s.

## Tests

- `typed-parts.test.ts` - each kind's fix, by example.
- `typed-parts.property.test.ts` - words kept, diagnostic line ranges
  inside the body.
