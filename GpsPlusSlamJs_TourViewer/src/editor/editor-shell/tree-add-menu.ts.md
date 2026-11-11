# tree-add-menu.ts

## Purpose

The tree's type menu: what a station row's "+" (and an empty station's
"Add content") adds in place - a short or a long text, or a picture, a
sound or a 3D model from a file, at a free spot of that station; a video
is offered in a story's menu only (on a station's it is off, saying to
add it to a story), and a character is listed, off, as coming. One menu
for every row, opened under the button pressed.

## Public API

- `createTreeAddMenu({ body, host, choose, chooseForStory })` - `openFor` for a
  station (its `choose` gets a kind or `"story"`: the Story item, behind a
  line, a station's alone), `openForStory` for a story ("Add to the story
  "<name>"", `chooseForStory`, no Story item). The focus returns to that row's
  "+".

- The menu's lines are `ADD_CHOICES` of the editor's list of kinds
  (`../../kinds/edit-kinds.ts`), in its order, `{ kind, label, hint, words,
look, addable }`, each item's `data-kind` its format kind: Short text ("A pin with a caption"), Long text ("A
  reading sign: a title and its text"), Picture, Video, Sound, 3D model
  (each opens the file picker: `../add-file-item.ts`), Character (off).
  On opening, the menu fits its items to the place: a `storyOnly` kind is
  off on a station's menu, its hint the reason. `words` is what a search
  for the kind matches.
- `addMenuSpot(anchor, size, view)` -> `{ left, top }` (window px, pure):
  under the button, opening rightwards from 20 px left of its right
  edge (over the view beside the tree, not over its rows), else as far
  right as fits, 8 px inside the window's edges; above the button where
  there is no room below it.
- `createTreeAddMenu({ body, host, choose })` -> `{ openFor(anchor,
stationId, title), close(returnFocus), isOpen() }`: builds
  `#tree-add-menu` (`.menu`, `role="menu"`) into `host`. `openFor` titles
  it "Add to <title>" (its head and its `aria-label`), places it, marks
  the opener `aria-expanded="true"` and focuses its first item. A click on
  an item that is not off closes it, the focus back on the station's
  "+", then calls `choose(stationId, kind)`.

## Invariants & assumptions

- Keys inside it are the WAI-ARIA menu's: the arrows wrap, Home and End
  jump, a letter moves to the next item whose label starts with it; the
  item that is off keeps its place in that order (`aria-disabled`, never
  `disabled`). Escape closes it with the focus back on the "+" and stops
  there (`stopPropagation`: the page's Escape would drop the selection);
  Tab closes it and lets the focus move; a press outside closes it.
- The focus goes back by the station's id (`[data-add="<id>"]` in
  `body`), not to the element pressed: "Add content" is gone once the
  station holds an item, and the shell's redraw after the add keeps the
  focus on the "+" by that id (`shell-tree.ts`'s focus keys). With the tree
  folded out of sight it goes to the button pressed, and if the add's draw
  takes that away the shell puts it on the details' Close.
- The menu closes before `choose` runs: the add may draw the tree again.
- Every word is text, never markup.

## Examples

```ts
const menu = createTreeAddMenu({
  body: treeBody,
  host: document.body,
  choose: (id, kind) => deps.edits.addItem(id, kind),
});
menu.openFor(plusButton, "gate", "The old gate");
```

## Tests

`tree-add-menu.test.ts` (jsdom): the menu titled by its station, its
items in order and the video and the character off with their reasons,
the video on in a story's menu; the keys through the items that are off; a choice
closing first, the focus back on the "+", `aria-expanded` back to false;
the item that is off adding nothing; Escape stopping at the menu; Tab and
a press outside closing it; `addMenuSpot` below, at the edges, above, and
a property that it stays inside the window. The shell's
`editor-shell.test.ts` covers the focus after the add's own redraw.

## Character

The menu has a "Character" item after the kinds and before the story ("Make
one in the character maker, then add it here"). It is not a `KIND_EDIT` add
row, because a character has to be made in the maker first. The choice
(`TreeAddChoice` `"character"`) goes to `choose` / `chooseForStory` like the
others, and the page runs the maker (`characters-panel.ts`, `makeForTour`).
The Ctrl+K palette does not offer it.
