# editor/page-inert.ts

## Purpose

Keeps the focus inside the desktop editor's modal dialogs (the tour
details, Done; M4a review #12): while one shows, every other part of the
page is made `inert`, so Tab cycles within the dialog instead of walking
into the map and the rail behind it. The dialogs are `hidden`-toggled
backdrops, not `<dialog>` elements; `inert` gives them what `showModal()`
would, without changing their markup or styles.

## Public API

- `holdPageInert(parts): () => void` - sets `inert` on each part not inert
  already; the returned release gives back exactly those, once.
- `InertPart` - `{ inert: boolean }`, structural (an `HTMLElement`).

## Invariants & assumptions

- A part inert for its own reason stays inert on release.
- A second release is a no-op, so a dialog closed twice wakes nothing.
- The caller passes the page's other top-level parts (`edit-main.ts`:
  `document.body`'s children except the dialog's backdrop and scripts).

## Examples

```ts
const release = holdPageInert(
  [...document.body.children].filter((el) => el !== backdrop),
);
// on close:
release();
```

## Tests

`page-inert.test.ts`: every part made inert, only those given back, a
second release harmless.
