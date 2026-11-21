# `editor-modals.ts` - Escape's order and the backdrop dialogs' hold

## Purpose

The editor page's two modal rules, page-free, so they are unit-tested:
which of the page's layers Escape closes first, and the hold that keeps
the focus inside a backdrop dialog by making the rest of the page inert.

The page has two modal mechanisms today: the characters panel and its
maker are native `<dialog>` elements (they close on their own Escape),
while Tour details and Share and publish are backdrops shown by toggling
`hidden`, held with `holdOutside`. A later change is meant to make them
one; the tests here pin what the page does until then.

## Public API

- `EscapeState` - what shows when Escape is pressed: `charactersOpen`,
  `detailsOpen`, `doneOpen`, `pointPick` (Pick in 3D armed), `startShown`
  (the open dialog), `tourOpen` (a tour behind it), `busy`.
- `escapeAction(state): EscapeAction` - first match wins:
  1. `native` - the characters' dialog shows; the page leaves Escape to it;
  2. `details` - Tour details closes;
  3. `done` - Share and publish closes;
  4. `pointPick` - Pick in 3D is disarmed, the selection kept;
  5. `closeStart` - the open dialog closes back to the open tour, only
     with a tour open and the page not busy;
  6. `deselect` - the selection is cleared.
- `holdOutside(backdrop, body = document.body): () => void` - every
  element child of `body` but `backdrop` and scripts made inert through
  `holdPageInert` (EditorKit `chrome`); the returned function gives back
  exactly what this call made inert, once.

## Invariants & assumptions

- `escapeAction` is pure; the page reads every flag before calling it
  (the reads are side-effect free getters).
- `holdOutside` touches the body's direct children only; a part that was
  inert already stays so after the release.

## Example

```ts
switch (
  escapeAction({
    charactersOpen,
    detailsOpen,
    doneOpen,
    pointPick,
    startShown: !modal.hidden,
    tourOpen: session !== null,
    busy,
  })
) {
  case "details":
    details.close();
    return;
  // ...
}
const release = holdOutside(element("details-modal"));
```

## Tests

- `editor-modals.test.ts` - each layer's case, a property over every
  combination for the order, and what the hold makes inert and gives
  back (jsdom).
