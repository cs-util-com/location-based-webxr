# phone-keyboard.ts

## Purpose

A phone's on-screen keyboard over the editor's panels: its height for the
styles, and the field in use brought into sight.

## Public API

- `keyboardPx(innerHeight, { height, offsetTop, scale })` - the keyboard's
  height from the visual viewport; 0 for none.
- `watchKeyboard(win, host)` -> stop: writes `--s-keyboard-h` and
  `data-keyboard="up"` on the body while a keyboard is up, and scrolls the focused field inside `host` into
  sight when the keyboard comes, when it grows while up, and when the
  focus moves under it. `relayout` (optional) runs each time the
  keyboard's height changes, before the field is scrolled: the docked
  panels are laid out by script a frame after their box changed, and
  a field scrolled into the old layout would be covered again. For the
  same reason the field is scrolled into sight again two frames later
  (the docked panels' contents are placed a frame after their groups). Whether it grew is read off the viewport's height
  alone, so a pan of the visual viewport (its `offsetTop`, also a
  `scroll` event) never pulls the field back. Stopping takes the value
  away.

## Invariants & assumptions

- A keyboard lies over the page in today's phone browsers: the layout
  viewport keeps its size and only the visual viewport shrinks.
- A zoomed viewport (`scale` over 1) and less than 80 px at the foot (a
  browser's bar) are no keyboard.
- Without a visual viewport nothing happens: the browser's own scrolling
  stays.
- The panels stand on the keyboard (`editor-shell.css`, `--s-keyboard-foot`):
  a panel gets shorter, or a sheet rises over the map, so its scroller ends
  above the keyboard and a field scrolled into it is in sight. A padding
  would not do: the scroller's box would still reach under the keyboard.
  The map's canvas is not resized for it.
- While a keyboard is up (`data-keyboard`) a phone's sheet takes all the
  room above it whatever its share, and its grip goes, and a long text's
  writer is no taller than that room: so the field in use and its row fit
  even in the least a keyboard leaves (a phone on its side with its
  browser's bar: about 116 px for the top bar and one row).

## Examples

```ts
const stop = watchKeyboard(window, view3d);
// later
stop();
```

## Tests

`phone-keyboard.test.ts` (jsdom, a stub for the visual viewport): the
height, a zoom, a browser's bar, the scroll, a pan that moves no field, a field outside, a browser
without the API. No test runs a real keyboard: only a phone can show that.
