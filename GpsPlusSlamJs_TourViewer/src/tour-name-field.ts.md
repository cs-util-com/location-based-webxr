# tour-name-field.ts

## Purpose

The phone's "Tour name" field in step 3 (tour editor plan 2026-10-17-1816,
W2): the tour's own name, apart from the poster's title. It shows the open
tour's title and hands what the creator did with it to the tour document
as a rename (`creator-setup.ts` `renameTour`), saved by the next Finish.
Before, the poster's title was the tour's name and an emptied one silently
kept the old title.

## Public API

- `wireTourNameField(input, store?, rename?): TourNameField`
  - `input` - the field (`TourNameInput`: `value` and its `input` and
    `change` listeners); structural, so the tests run in node.
  - `rename` (`TourNameRename`) - `apply(name)`, the document's rename
    (null when taken, else why not), and the `error` line beside the
    field that says a refusal (hidden otherwise). Applied when the field
    is left (`change`, not per key: each rename is one undo step and one
    draft write) and at `present` - a kept name from before a reload is
    this page's work again, and an untouched present clears a refusal.
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
  - `commit()` - hand what is in the field to the document now, as
    leaving it does: the Finish's start calls it (`main.ts`
    `beforeFinish`), since the tap that starts a Finish may not fire
    "change" (the r880 milestone review LOW-3).

## Invariants & assumptions

- Untouched means null, whatever the field shows: nothing is renamed, so
  a field that was never presented a title cannot remove one.
- An emptied name is `""`: the rename removes the title.
- Every `present` starts untouched again, unless a kept name applies;
  `main.ts` presents on every open and close (`hooks.presentTourInfo`,
  creator mode).
- A store that throws (site data blocked) or holds a damaged value keeps
  nothing; the name then lasts this page.

## Examples

```ts
const field = wireTourNameField(element("tour-name-input"), localStorage, {
  apply: (name) => setup.renameTour(name),
  error: element("tour-name-error"),
});
hooks.presentTourInfo = (tour) => field.present(tour?.manifest?.title ?? null);
```

## Tests

- `tour-name-field.test.ts` - presented untouched, typed, emptied, a new
  tour untouched again, no tour clears it; a typed name kept across a
  reload for its tour, spent once the file carries another title, and a
  store that throws; the rename when the field is left (not per key), a
  refusal said and cleared, a kept name renamed at the open.
- `finish-rebuild.test.ts`, `creator-finish.test.ts` - typed, emptied and
  untouched names at the Finish; `creator-document.test.ts` the rename's
  check; `tour-document-parity.test.ts` the phone's rename against the
  desktop's.
