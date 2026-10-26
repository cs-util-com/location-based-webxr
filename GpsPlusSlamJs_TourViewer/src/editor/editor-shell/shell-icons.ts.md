# shell-icons.ts

## Purpose

The 3D view's shell icons: small line drawings on a 16-unit grid, drawn
in the current text colour, as SVG elements.

## Public API

- `ShellIcon` - the icon names (`pin`, `photo`, `model`, `frame`, `top`,
  `undo`, `redo`, `help`, `qr`, `down`, `right`, `up`, `close`,
  `station`, `pencil`, `check`, `lock`, `unlock`, `walk`, `eye`, `folder`,
  and for the tree's editing `plus`, `earlier`, `later`, `trash`, `split`,
  `dup`, `align`, `copy` (the prototype's) and `grip` (a card's six dots),
  and for the inspector's Put on the ground `ground` (the prototype's)).
- `shellIcon(name)` - a new `svg.i` element, `aria-hidden` (the control it
  sits in carries the words).
- `placeShellIcons(root)` - every `<i data-icon="name">` under `root`
  replaced by its icon (the page's static buttons in `edit.html`); an
  unknown name is left as it is, and so is a name of
  `Object.prototype` such as `toString` (`Object.hasOwn`, not `in`).

## Invariants & assumptions

- Constant markup only: nothing from a tour reaches an icon.
- Original simple paths, the studio prototype's.
- `lock` and `unlock`: the station pose lock's two states (inline SVG, as every icon here).

## Examples

```ts
button.append(shellIcon("undo"));
placeShellIcons(document.getElementById("topbar")!);
```

## Tests

`shell-icons.test.ts` (jsdom): each named icon put in place, an unknown
name and `toString` left; an icon drawn in the text colour and hidden
from screen readers. `playwright-tests/editor3d-shell.spec.js` shows the
studio's buttons.

The icons are drawn by `shell-inspector.test.ts`'s lock test.
