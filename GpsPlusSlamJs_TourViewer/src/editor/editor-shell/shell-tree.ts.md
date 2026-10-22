# shell-tree.ts

## Purpose

The 3D view's tree dock drawn from its model (`tree-model.ts`): the
stations' story cards with their items, the codes and the layer chips.

## Public API

- `drawTree(dock, tree, folded, pictures)` - `dock` is `{ root,
stationsHead, fold, body }` (`#shell-tree`, `#tree-stations`,
  `#tree-fold`, `#tree-body`); replaces the body's children and the
  heads' contents. The drawn elements carry what the shell's clicks read:
  - `data-select` - a card's picture, an item's or a code's row: the
    page's selection id;
  - `data-unfold` - a card's fold arrow: the station's id;
  - `data-section` - a section header (`stations`, `codes`, `layers`);
  - `data-layer` - a chip, with `aria-pressed`.
- Classes as the studio prototype's: `.card` (`.sel`, `.ctx`), `.hero`
  (`.nodesc`), `.kid`, `.row`, `.chip` (`.on`), `.collapsed` on the dock.

## Invariants & assumptions

- Every name and line is set as text, never as markup (they come from a
  file anyone can write).
- A card's picture is asked of `pictures` (`shell-pictures.ts`), which
  reads it only once the card is in view.
- Draws only; no listeners (the shell's delegated click reads the data
  attributes).

## Examples

```ts
drawTree(dock, buildTree(input), view.foldedDocks.tree, pictures);
```

## Tests

No unit test (no DOM in the unit runner); its model is unit-tested
(`tree-model.test.ts`, `tree-model.property.test.ts`) and the drawing by
`playwright-tests/editor3d-shell.spec.js`.
