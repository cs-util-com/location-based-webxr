# tour-fields.ts

## Purpose

The field checks every reader of `tour.json` shares: an id, a non-blank
text, a list, a positive whole number, and ids that must not repeat. One
implementation, so the words an author reads for a broken file are the
same wherever the file breaks (`tour-assets.ts`, `tour-blocks.ts`,
`tour-story.ts`, `tour-stations.ts`, `tour-manifest.ts`).

## Public API

- `TourFail` - `(message: string) => never`, the caller's own failure
  (it throws the caller's validation error).
- `isTourId(value): value is string` - a short, path-safe id
  (`TOUR_ID_PATTERN`: one path segment of 1-64 letters, digits, `_` or
  `-`).
- `requireTourId(value, at, fail): string` - the id, or
  `"<at>" must be a short path-safe id`.
- `tourTextOf(value): string | undefined` - a non-blank string as
  written, else undefined.
- `requireTourText(value, at, fail): string` - the text as written, or
  `"<at>" must be a non-empty string`.
- `requireTourArray(value, at, fail): unknown[]` - the array, or
  `"<at>" must be an array`.
- `isPositiveInteger(value): value is number` - a finite whole number
  above zero.
- `assertUniqueTourIds(ids, what, fail, prefix = '')` - fails on the
  first repeated id: `<prefix>duplicate <what> id "<id>"`.

## Invariants & assumptions

- No error class and no import of any caller: each check takes the
  caller's `fail` (`check:cycles` stays clean).
- Texts are kept as written: only the blank check trims. A capped text's
  count is `tour-blocks.ts`'s `tourTextCount`, not here.
- Pure: no state, no I/O.

## Examples

```ts
const id = requireTourId(value.id, `${at}.id`, fail);
assertUniqueTourIds(
  steps.map((s) => s.id),
  'step',
  fail,
  `${at}: `
);
```

## Tests

- Through every reader that uses it (`tour-blocks.test.ts`,
  `tour-story.test.ts`, `tour-stations.test.ts`, `tour-manifest.test.ts`):
  each message an author reads is asserted there, at the place it names.
