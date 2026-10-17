# tour-name-field.ts

## Purpose

The phone's "Tour name" field in step 3 (tour editor plan 2026-10-17-1816,
W2): the tour's own name, apart from the poster's title. It shows the open
tour's title and tells the Finish (`creator-finish.ts` `tourTitle`) what the
creator did with it. Before, the poster's title was the tour's name and an
emptied one silently kept the old title.

## Public API

- `wireTourNameField(input): TourNameField`
  - `input` - the field (`TourNameInput`: `value` and an `input`
    listener); structural, so the tests run in node.
  - `present(title)` - a tour opened (its title, or null) or closed
    (null): the field shows it, untouched.
  - `typed()` - what the creator typed since then (`""` for an emptied
    name), or null when they typed nothing.

## Invariants & assumptions

- Untouched means null, whatever the field shows: the Finish then keeps
  the tour's own title (`finish-rebuild.ts` `finishTitle`), so a field
  that was never presented a title cannot remove one.
- An emptied name is `""`: the Finish removes the title.
- Every `present` starts untouched again; `main.ts` presents on every open
  and close (`hooks.presentTourInfo`, creator mode).

## Examples

```ts
const field = wireTourNameField(element("tour-name-input"));
hooks.presentTourInfo = (manifest) => field.present(manifest?.title ?? null);
// at the Finish:
tourTitle: () => field.typed(),
```

## Tests

- `tour-name-field.test.ts` - presented untouched, typed, emptied, a new
  tour untouched again, no tour clears it.
- `finish-rebuild.test.ts`, `creator-finish.test.ts` - typed, emptied and
  untouched names at the Finish.
