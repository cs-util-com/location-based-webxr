# scene-menu.ts

## Purpose

The 3D view's ground menu: a right click (a long press on a touch
screen) on the scene opens it where the pointer was, with one command,
"New station here". The 3D view's input reports the press and the ground
under it (`editor3d-input.ts`, `groundMenu`); the shell opens this menu.

## Public API

- `createSceneMenu({ box, menu, item, returnFocus, newStation })` ->
  `SceneMenu`:
  - `box` - the view's box, the menu's positioned parent;
  - `menu` / `item` - `#scene-menu` and `#scene-new-station` (`edit.html`);
  - `returnFocus` - where the focus goes back after Escape or a choice;
  - `newStation(place)` - starts a station at a `GroundPlace`
    (`{ lat, lon, alt }`, the ground's ellipsoidal height).
- `SceneMenu.openAt(point, place)` - open at `point` (px from the view's
  top left) for `place`, or for none (`null`: no ground has loaded
  there); `close()`; `isOpen()`.

## Invariants & assumptions

- A menu by the WAI-ARIA pattern: `role="menu"` named "The ground here",
  its item a `menuitem` (`tabindex="-1"`), focused on opening.
- The menu stays 8 px inside the view's box at every edge.
- With no place the item is disabled the menu pattern's way
  (`aria-disabled`, `setItemDisabled`), its title says why, and its click
  does nothing; the menu stays open.
- A choice closes the menu (focus back on the view) before it starts the
  station, once.
- Escape closes it with the focus back on the view and goes no further
  (the page's own Escape would deselect); Tab closes it and lets the focus
  move on; a press outside it closes it (a capture listener while open).
  Its keys never reach the scene: `key-target.ts`'s `inMenu`.

## Examples

```ts
const ground = createSceneMenu({
  box,
  menu,
  item,
  returnFocus: canvas,
  newStation: (place) => deps.stations.add(place, "here"),
});
ground.openAt({ x: 120, y: 80 }, { lat: 48.1, lon: 11.5, alt: 561 });
```

## Tests

`scene-menu.test.ts` (jsdom, stubbed boxes): the roles; the place and the
focus on opening; the edges; a choice starts one station and closes; no
ground: disabled, said, nothing started; Escape; Tab and a press outside;
a press inside. End to end: `playwright-tests/editor3d-tree.spec.js`.
