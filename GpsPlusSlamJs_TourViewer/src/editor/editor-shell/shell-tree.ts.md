# shell-tree.ts

## Purpose

The 3D view's tree dock drawn from its model (`tree-model.ts`) as a file
explorer draws one: a row per station with its items, the codes and the
layer chips. A folded station is one compact line; an unfolded one adds
its picture, story folders and items below that line.

## Public API

- `drawTree(dock, tree, folded, pictures, rows = {})` - `dock` is `{ root,
stationsHead, fold, body }` (`#shell-tree`, `#tree-stations`,
  `#tree-fold`, `#tree-body`); replaces the body's children and the
  heads' contents. Every control is a `<button>` (none inside
  another), so the tree is in the Tab order and Enter or Space works it.
  A card (`.card`) is drawn as:
  - `.head` - its one-line row, always, in this order: the grip
    `.grip`, the fold arrow `.tw` (a button), `.pick` (the button that
    selects it: the number chip `.n`, then the name `.nm` beside it,
    its `title` the full name), `.lockg` only for an unlocked station
    (every station starts locked, so a lock on every row would say
    nothing), `.meta` - the item count, only folded and when it holds
    any (titled "1 item" / "N items"), then `.add` - the row's "+"
    (`data-add`, titled 'Add to "..."', `aria-haspopup="menu"`), its
    last piece, which opens the type menu (`tree-add-menu.ts`);
  - `.pic` - no control, a strip a tap on which selects the station as
    `.pick` does (`.pick` is the way for the keyboard) - only when unfolded AND the station has a picture: the
    picture under the row (no empty frame when it has none), hidden
    from screen readers;
  - `.kids` - only when unfolded: its story folders first (`.folder`, `data-story` its
    id: `.tw` its fold, `data-folder`; `.fname` its icon and name,
    `data-select="story:<id>"`; `.meta` its entry count; `.add`,
    `data-storyadd`; its entries `.kid.deep`, their place in `.meta`, under it
    when open, or `.emptyrow.deep` with "Add the first entry", `data-storyfill`),
    then its plain folders (`.folder.gfolder`, `data-plainfolder` its id,
    `data-list="free"`, `data-item`, `data-into="folder:<id>"`: its grip,
    `.tw` its fold, `data-pfold`; `.fname` its teal icon `.ic.fold` and
    name, `data-select="folder:<id>"`, titled "<name> (a folder: a group in
    the scene)"; `.meta` "N items"; `.ren` the pen, `data-rename`, titled
    "Rename (F2)"; a `.cb` checkbox; while renamed, `.fname` holds the
    name field `input.renin`, `data-ren`, `maxLength` the format's cap
    (80; UTF-16 units, so never more than the reader takes), in place of the button, the
    count and the pen; when open its items `.kid.deep.infolder`, the last
    `.last`, on a teal guide line (`.ctx`, the folder's teal band, while
    the folder is selected and the item is not: they move with it), or
    `.emptyrow.deep.infolder` "Empty -
    drag items here" with its `data-into`),
    then its items (`.kid`), or `.emptyrow` "Nothing here yet. " with its
    `.fill` "Add content" (`data-fill`), the same menu. Every free item's
    and in-folder item's row ends in a `.cb` checkbox (`.cb.on` when
    picked), shown only in the Select mode.

  `rows` (`TreeRowsState`) says what the model does not: `renaming` (a
  `TreeRenaming` `{ id, text }`: the folder whose name field shows, with
  its text as typed), `selectMode` (the body gets `.selmode`: checkboxes
  show, counts hide) and `groupHint` (a `.hint` after the cards on how to
  group, its `.fine` words for a mouse and `.coarse` for a finger; the
  stylesheet shows the one that fits).

- `drawSelectionBar(bar, model)` - the picked rows' bar
  (`#tree-selbar`) from `selectionBarOf` (`folder-commands.ts`): hidden
  when `show` is false; else `.cnt` ("Tick rows" or "N selected"), the
  `.abtn.primary` Group (`data-selbar="group"`), Ungroup
  (`data-selbar="ungroup"`), Done in the Select mode
  (`data-selbar="done"`), then `.why` when there is a line to say. A
  button that cannot act is drawn disabled, not left out, and the focus
  stays on the button that had it.

  A search that finds nothing draws `.nomatch` 'Nothing matches "..."'
  at the body's top (wrapped anywhere: a long word typed stays inside
  the dock). The station's description is no line of the list
  (the inspector shows it).

  After a redraw the focus goes back to the control that had it (found
  by its data attribute), a text field's caret with it. The drawn elements carry what the shell's
  clicks read:
  - `data-select` - a card's `.pick`, an item's or a code's row (with
    `aria-pressed`): the page's selection id;
  - `data-unfold` - a card's fold arrow: the station's id;
  - `data-section` - a section header (`stations`, `codes`, `layers`);
  - `data-layer` - a chip, with `aria-pressed`;
  - `data-add` - a card's "+", and `data-fill` - its empty line's "Add
    content": the station's id, the station the type menu adds to;
  - `data-move` - the grip of a story, an entry or a free item (a
    `<span>` outside its buttons, hidden from screen readers; none while
    a search runs): the item `createNestDrag` drags, with its row's
    `data-list` (`stories`, `story:<id>`, `folder:<id>` or `free`) and
    `data-item`. `data-into` names the list a drop on that row goes
    into: a story's row and its empty line its story, a plain folder's row
    and its empty line the folder, the card's head the free items.
  - `data-pfold` - a plain folder's fold arrow, `data-rename` its pen,
    `data-ren` its name field while renamed: the folder's id.
  - `data-drag` - a card's grip (`.grip`, a `<span>` beside the card's
    buttons, never inside one, hidden from screen readers, titled "Drag
    to change its place in the tour"): the station `tree-drag.ts` drags.
    While a search runs it is `.grip.off`, with no `data-drag` (it drags
    nothing) and titled "Clear the search to change the order".
    It sits first in the row (4 px in), left of the fold arrow, its
    height, 4 px apart; drawn only under the pointer, on the selection
    and on a touch screen.

- Classes: `.card` (`.sel`, `.ctx`, `.open` while unfolded), `.head`,
  `.lockg`, `.meta`, `.add`, `.pic`, `.folder` (`.gfolder`), `.kid` (`.deep`,
  `.infolder`, `.last`), `.emptyrow`, `.cb` (`.on`), `.ren`, `.renin`, `.hint`,
  `.selmode` on the body,
  `.nomatch`, `.row`, `.chip` (`.on`), `.collapsed` on the dock.

## Invariants & assumptions

- Every name and line is set as text, never as markup (they come from a
  file anyone can write).
- A folded card's row is one line whatever the name's length: the
  stylesheet (`editor-shell.css`, `.card > .head`, `.head .pick`,
  `.head .nm`, `.head .n`) gives the row a fixed 28 px height (34 px on
  a phone, 700 px or less, where an item's row is 32 px) and
  flex layout, keeps the chip from shrinking and cuts the name with an
  ellipsis (`nowrap`, `min-width: 0`); the full name stays in the
  button's title and accessible name.
- The row's frame (the explorer's): 4 px padding at both ends and a
  4 px gap; the grip, the arrow, then `.pick` filling the row's height
  (`align-self: stretch`) and the width left (`flex: 1 1 auto`), the
  row's last piece 4 px from its right edge; the row centres its pieces
  (`align-items: center`). The rows are flush with the dock and with
  each other; the selection is the accent's tint with a 2 px bar at the
  left. An item's icon sits 16 px right of its station's number chip,
  the picture and the empty line 6 px left of that.
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
folded card as one row of grip, arrow, number and name, and its count
where it holds items (no picture asked); an unfolded card's picture and
items below its row (no count), a station without items saying so, a
station without a picture drawing none, both marked
`open` (no folded card is); every card, item and
code a button, none inside another; the selection and the unfolded
station shown; the focus kept on the pressed control across a redraw;
the folded dock; each card's grip, outside its buttons; the unlocked
station's mark (and no locked one's); a search's rows and its "Nothing
matches"; story folders drawn before the free items (a hand-made model).
The plain folders' rows, the checkboxes, the name field and the selection
bar are driven through the shell in `editor-shell.test.ts` ("the tree's
plain folders") and in a browser in `playwright-tests/editor3d-folders.spec.js`.
`shell-tree.property.test.ts`: for any names (short, 40-400 characters,
spaces, line breaks, markup-looking text) every folded card is the same
one-row structure with the name as text and the full name in the title;
the stylesheet holds the row to one 28 px line with an ellipsis. Its
model in `tree-model.test.ts` and `tree-model.property.test.ts`; the
keyboard walk (Tab to a card, Enter selects, Space folds) and the rows'
28 px height in `playwright-tests/editor3d-shell.spec.js`; the one-line
layout for a one-letter, a medium and a very long name at 390x844,
844x390 and 1440x900 - each row pinned to its frame too (the fold arrow
centred on it, the row's last piece 4 px from its right edge, the selectable
box filling the row's height after the arrow, the grip 4 px in) - the
unfolded long name wrapping while the folded row stays one line, and the
unfolded picture, in
`playwright-tests/editor3d-tree.spec.js`.
