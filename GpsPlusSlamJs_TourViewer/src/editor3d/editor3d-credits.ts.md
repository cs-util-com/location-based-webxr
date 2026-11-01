# editor3d-credits.ts

## Purpose

The 3D views' credits (both the globe view, `editor3d-globe.ts`, and the
OrbitControls view, `editor3d-scene.ts`): one "Credits" button at the
bottom left of the view instead of a line of short names over the canvas.
A click opens an overlay listing every source in full with its link, and
a note under the list (the globe view passes GIBS's acknowledgement).

## Public API

- `mountCredits(box, credits, { note?, osmBeside? }) => unmount`
  - `box` - the view's credits box (`#view3d-credits`); emptied first.
  - `credits` - `{ short, full, href }[]` (the globe's credit shape), shown
    in their order as links with the full text, opening in a new tab
    (`rel=noopener`).
  - `note` - a paragraph under the list; none when absent or empty.
  - `osmBeside` - also show the map's credit (the one whose short name is
    "OpenStreetMap", its full text "© OpenStreetMap contributors") as a
    link beside the button. Defaults to the module's `OSM_BESIDE_BUTTON`,
    which is `false`: the owner chose the button alone.
  - `unmount()` - removes the listeners and empties the box.

## DOM

- `button.view3d-credits-button[type=button][aria-expanded][aria-controls][aria-haspopup=dialog]`, "Credits";
- `a.view3d-credits-beside`, only with `osmBeside`;
- `div.view3d-credits-panel[role=dialog][aria-label=Credits][hidden]`
  holding a `ul` of links and `p.view3d-credits-note`.
- The styles live in `../editor/editor.css` (the panel opens above the
  button).

## Invariants and assumptions

- Texts are set as `textContent`, never as markup.
- Closing: the button toggles; Esc anywhere in the box closes it and gives
  focus back to the button (the event is stopped there, so one Esc does
  nothing else in the editor); a pointer down outside the box closes it
  without moving focus (the browser gives focus to what was pressed).
  While closed Esc is left alone.
- The document's `pointerdown` listener (capture) is added only while
  open, and removed on close and on unmount.

## Examples

```ts
undo.push(
  mountCredits(deps.credits, [...creditsFor(ids), ...ground.credits], {
    note: GIBS_ACKNOWLEDGEMENT,
  }),
);
```

## Tests

- `editor3d-credits.test.ts` (jsdom) - the button alone, the overlay's
  links and note, text never markup, Esc with focus back, Esc left alone
  while closed and stopped while open, outside and inside pointer downs,
  the toggle, the OSM option, unmount.
- `editor3d-globe.test.ts` - the globe view mounts it with GIBS's
  acknowledgement and empties it on dispose.
- `playwright-tests/editor3d.spec.js` - opening it in the page, Esc and
  focus.
