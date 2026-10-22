# shell-tree.ts

## Purpose

The 3D view's tree dock drawn from its model (`tree-model.ts`): the
stations' story cards with their items, the codes and the layer chips.

## Public API

- `drawTree(dock, tree, folded, pictures)` - `dock` is `{ root,
stationsHead, fold, body }` (`#shell-tree`, `#tree-stations`,
  `#tree-fold`, `#tree-body`); replaces the body's children and the
  heads' contents. Every control is a `<button>` (none inside
  another), so the tree is in the Tab order and Enter or Space works it;
  a card's hero holds two sibling buttons, `.pick` (the picture, over
  the whole hero) and `.tw` (the fold arrow). After a redraw the focus
  goes back to the control that had it (found by its data attribute). The
  drawn elements carry what the shell's clicks read:
  - `data-select` - a card's `.pick`, an item's or a code's row (with
    `aria-pressed`): the page's selection id;
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

`shell-tree.test.ts` (jsdom, from store states through `buildTree`): a
card per station with its number, name and description; every card,
item and code a button, none inside another; the selection and the
unfolded station shown; the focus kept on the pressed control across a
redraw; the folded dock. Its model in `tree-model.test.ts` and
`tree-model.property.test.ts`; the keyboard walk (Tab to a card, Enter
selects, Space folds) in `playwright-tests/editor3d-shell.spec.js`.
