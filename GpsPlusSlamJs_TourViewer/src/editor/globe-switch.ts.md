# globe-switch.ts

## Purpose

The link switch that opens the desktop editor's 3D view on the full globe
(`edit.html?globe=1`), and the two knobs the owner tunes by eye for the
globe's visibility rule (`../editor3d/globe-visibility.ts`). Without the
switch the editor's own 3D view (OrbitControls over a local ground) stays
the default.

## Public API

- `GLOBE_SWITCH` - `param` `"globe"`; the knobs (`GlobeSwitchKnob`:
  `param`, `fallback`, `min`, `max`):
  - `hidePx` - `globeHidePx`, default 3, range 0.5-200: an object hides
    below this size on screen (CSS px);
  - `crowdPx` - `globeCrowdPx`, default 24, range 0-500: a station pin
    hides when its nearest neighbour on screen is closer (0 turns the
    crowding off).
- `readGlobeSwitch(search)` -> `GlobeSwitch` (`on`, `hidePx`, `crowdPx`)
  from a link's query, with or without its "?".

## Invariants & assumptions

- **Off unless asked:** only `globe=1` turns it on (`0`, `true`, `yes`,
  empty: off), so no existing link changes what it opens.
- **A typo never breaks the view:** a knob that is empty, not a number,
  not finite or outside its range reads as its default.
- **Light:** no import of the globe or of three, so the page reads it on
  its first load without pulling the 3D view's code.
- The defaults are starting points for the owner's tuning: a 1 m sign at
  a 50-degree field of view in an 800 px tall view is about 3 px at
  300 m (the owner's "a sign after a few hundred metres"); 24 px is about
  a pin's own width.

## Examples

```ts
const globe = readGlobeSwitch(location.search);
if (globe.on) {
  /* open the globe view with globe.hidePx, globe.crowdPx */
}
```

## Tests

`globe-switch.test.ts`: off with its defaults without the switch, on only
for `globe=1`, both knobs read, a bad or out-of-range knob read as its
default, the bounds themselves accepted, the defaults inside their ranges.
