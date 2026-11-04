# shell-tree.ts

## Purpose

The 3D view's tree dock drawn from its model (`tree-model.ts`): the
stations' cards with their items, the codes and the layer chips. A
folded station is one compact line; an unfolded one adds its picture,
description and items below that line.

## Public API

- `drawTree(dock, tree, folded, pictures)` - `dock` is `{ root,
stationsHead, fold, body }` (`#shell-tree`, `#tree-stations`,
  `#tree-fold`, `#tree-body`); replaces the body's children and the
  heads' contents. Every control is a `<button>` (none inside
  another), so the tree is in the Tab order and Enter or Space works it.
  A card (`.card`) is drawn as:
  - `.head` - its one-line row, always: `.pick` (the button that
    selects it: the number chip `.n`, then the name `.nm` beside it,
    its `title` the full name), the grip `.grip` and the fold arrow
    `.tw` (a sibling button);
  - `.pic` - only when unfolded AND the station has a picture: the
    picture under the row (no empty frame when it has none), hidden
    from screen readers;
  - `.ds` - only when unfolded and it has a description: one line;
  - `.kids` - only when unfolded: its items, or "No items yet.".

  After a redraw the focus goes back to the control that had it (found
  by its data attribute). The drawn elements carry what the shell's
  clicks read:
  - `data-select` - a card's `.pick`, an item's or a code's row (with
    `aria-pressed`): the page's selection id;
  - `data-unfold` - a card's fold arrow: the station's id;
  - `data-section` - a section header (`stations`, `codes`, `layers`);
  - `data-layer` - a chip, with `aria-pressed`;
  - `data-drag` - a card's grip (`.grip`, a `<span>` beside the card's
    buttons, never inside one, hidden from screen readers, titled "Drag
    to change its place in the tour"): the station `tree-drag.ts` drags.
    It sits left of the fold arrow, its height, 4 px apart.

- Classes: `.card` (`.sel`, `.ctx`, `.open` while unfolded), `.head`, `.pic`, `.ds`, `.kid`,
  `.row`, `.chip` (`.on`), `.collapsed` on the dock.

## Invariants & assumptions

- Every name and line is set as text, never as markup (they come from a
  file anyone can write).
- A folded card's row is one line whatever the name's length: the
  stylesheet (`editor-shell.css`, `.card > .head`, `.head .pick`,
  `.head .nm`, `.head .n`) gives the row a fixed 28 px height and
  flex layout, keeps the chip from shrinking and cuts the name with an
  ellipsis (`nowrap`, `min-width: 0`); the full name stays in the
  button's title and accessible name.
- The row's frame: `.pick` fills the row's height (`align-self:
stretch`) and its width up to the grip (`flex: 1 1 auto`, the row's
  4 px gap), and the row centres the grip and the fold arrow
  (`align-items: center`), the arrow 5 px (the row's padding) from the
  row's right edge.
- An unfolded card (`.card.open`) is no longer one compact line: its
  name wraps (`overflow-wrap: anywhere`), the row growing from 28 px
  with it (on a phone a folded name gets about 115 px); folded again it
  is one 28 px line.
- A card's picture is asked of `pictures` (`shell-pictures.ts`) only for
  an unfolded card, which reads it once the picture is in view; a folded
  card asks for none.
- Draws only; no listeners (the shell's delegated click reads the data
  attributes).

## Examples

```ts
drawTree(dock, buildTree(input), view.foldedDocks.tree, pictures);
```

## Tests

`shell-tree.test.ts` (jsdom, from store states through `buildTree`): a
folded card as one row of its number then its name, nothing else (no
picture asked); an unfolded card's picture, description and items below
its row, a station without a picture drawing none, both marked
`open` (no folded card is); every card, item and
code a button, none inside another; the selection and the unfolded
station shown; the focus kept on the pressed control across a redraw;
the folded dock; each card's grip, outside its buttons.
`shell-tree.property.test.ts`: for any names (short, 40-400 characters,
spaces, line breaks, markup-looking text) every folded card is the same
one-row structure with the name as text and the full name in the title;
the stylesheet holds the row to one 28 px line with an ellipsis. Its
model in `tree-model.test.ts` and `tree-model.property.test.ts`; the
keyboard walk (Tab to a card, Enter selects, Space folds) and the rows'
28 px height in `playwright-tests/editor3d-shell.spec.js`; the one-line
layout for a one-letter, a medium and a very long name at 390x844,
844x390 and 1440x900 - each row pinned to its frame too (the fold arrow
about 5 px from the row's right edge and centred on it, the selectable
box 28 px high and clear of the grip) - the unfolded long name wrapping
while the folded row stays 28 px, and the unfolded picture, in
`playwright-tests/editor3d-tree.spec.js`.
