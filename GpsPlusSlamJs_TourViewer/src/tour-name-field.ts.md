# tour-name-field.ts

## Purpose

The phone's "Tour name" field in step 3 (tour editor plan 2026-10-17-1816,
W2): the tour's own name, apart from the poster's title. It shows the open
tour's title and tells the Finish (`creator-finish.ts` `tourTitle`) what the
creator did with it. Before, the poster's title was the tour's name and an
emptied one silently kept the old title.

## Public API

- `wireTourNameField(input, store?): TourNameField`
  - `input` - the field (`TourNameInput`: `value` and an `input`
    listener); structural, so the tests run in node.
  - `store` - where a typed name is kept across a reload
    (`localStorage`, `tour-viewer.tour-name.<tour key>`; M4a review #12:
    the poster text survived a reload, the name beside it did not).
  - `present(title, key?)` - a tour opened (its title, or null; `key` its
    file's key, `archive.url`) or closed (null): the field shows the name
    kept for that tour, as typed (touched), when the tour still carries the
    title it was typed over; else the title, untouched - and a kept name
    whose tour now carries another title (a Finish wrote it, or the editor
    renamed it) is forgotten.
  - `typed()` - what the creator typed since then (`""` for an emptied
    name), or null when they typed nothing.

## Invariants & assumptions

- Untouched means null, whatever the field shows: the Finish then keeps
  the tour's own title (`finish-rebuild.ts` `finishTitle`), so a field
  that was never presented a title cannot remove one.
- An emptied name is `""`: the Finish removes the title.
- Every `present` starts untouched again, unless a kept name applies;
  `main.ts` presents on every open and close (`hooks.presentTourInfo`,
  creator mode).
- A store that throws (site data blocked) or holds a damaged value keeps
  nothing; the name then lasts this page.

## Examples

```ts
const field = wireTourNameField(element("tour-name-input"));
hooks.presentTourInfo = (manifest) => field.present(manifest?.title ?? null);
// at the Finish:
tourTitle: () => field.typed(),
```

## Tests

- `tour-name-field.test.ts` - presented untouched, typed, emptied, a new
  tour untouched again, no tour clears it; a typed name kept across a
  reload for its tour, spent once the file carries another title, and a
  store that throws.
- `finish-rebuild.test.ts`, `creator-finish.test.ts` - typed, emptied and
  untouched names at the Finish.
