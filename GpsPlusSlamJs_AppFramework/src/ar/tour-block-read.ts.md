# tour-block-read.ts

**Purpose:** the toolkit a kind's row reads its fields with: capped texts,
asset references, sizes, and the strict or lenient answer to a broken rule.
`tour-kinds.ts` uses it for every kind, and `tour-blocks.ts` for the
envelope. It imports neither, so a row never reaches the list it belongs to.

## Public API

- `TourTextRule`, `TourTextUnit`, `required(max, unit?)`, `optional(max)` - a
  capped text. `required` fails the file when blank or over; `optional` is
  left out, and reported when it is over or not text.
- `tourTextCount(text, unit = 'codePoints')` - THE count every cap uses.
- `checkTourBlockText(rule, value): TourBlockTextCheck`.
- `TourBlockFields` - a block as read: an open record.
- `TourBlockReadContext` - `{ id, at, assets, characters, fail, lenient,
onDropped }`.
- `TourBlockDrop`, `TourDeclaredCharacter`.
- `TourSkippedBlock` - thrown by `problem` for a lenient read, caught by the
  block reader.
- `problem(ctx, message)` - skips the block in a newer minor, fails the file
  at this reader's own.
- `dropped(ctx, field, reason)` - for an optional field a later minor may
  give new values: fails the file at this reader's own minor, drops that
  field alone (reported as a `field` drop) from a newer one.
- `choice(v, field, choices, ctx)` - an optional word: a value that is not
  a string fails at every minor, an unknown word is `dropped`. The short
  text's look fields and the video's `start`, `sound`, `alpha` and `loop`
  read through it.
- `requiredText`, `optionalText`, `assetRef`, `optionalAssetRef`, `metres` -
  one field each.

## Invariants & assumptions

- `optionalText` reports nothing for a blank text and nothing in a lenient
  read: a blank optional text is simply absent.
- `problem` skips a whole block, `dropped` one optional field: a value a
  newer minor may add to an optional field must never cost the block.
- `problem` is for a rule a later minor may relax. `ctx.fail` is for what no
  revision can make valid.
- `assetRef` resolves a reference against `ctx.assets`, so a renderer never
  meets a dangling id.

## Examples

```ts
const caption = requiredText(v, 'caption', rule, ctx);
const poster = optionalAssetRef(v, 'poster', 'image', ctx); // {} or { poster }
```

## Tests

`tour-blocks.test.ts` and `tour-blocks.property.test.ts`, through the reader.
