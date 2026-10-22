# shell-icons.ts

## Purpose

The 3D view's shell icons: small line drawings on a 16-unit grid, drawn
in the current text colour, as SVG elements.

## Public API

- `ShellIcon` - the icon names (`pin`, `photo`, `model`, `frame`, `top`,
  `undo`, `redo`, `help`, `qr`, `down`, `right`, `up`, `close`,
  `station`, `pencil`, `check`, `folder`).
- `shellIcon(name)` - a new `svg.i` element, `aria-hidden` (the control it
  sits in carries the words).
- `placeShellIcons(root)` - every `<i data-icon="name">` under `root`
  replaced by its icon (the page's static buttons in `edit.html`); an
  unknown name is left as it is.

## Invariants & assumptions

- Constant markup only: nothing from a tour reaches an icon.
- Original simple paths, the studio prototype's.

## Examples

```ts
button.append(shellIcon("undo"));
placeShellIcons(document.getElementById("topbar")!);
```

## Tests

No unit test (no DOM in the unit runner);
`playwright-tests/editor3d-shell.spec.js` shows the studio's buttons.
