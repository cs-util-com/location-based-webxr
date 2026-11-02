# globe-switch.ts

## Purpose

The link switch that opens the desktop editor's 3D view on the full globe
(`edit.html?globe=1`), and the knobs tuned by eye: the globe's
visibility rule (`../editor3d/globe-visibility.ts`) and the approach's
meteor (`../editor3d/globe-approach-meteor.ts`). Without the
switch the editor's own 3D view (OrbitControls over a local ground) stays
the default.

## Public API

- `GLOBE_SWITCH` - `param` `"globe"`; the knobs (`GlobeSwitchKnob`:
  `param`, `fallback`, `min`, `max`):
  - `hidePx` - `globeHidePx`, default 3, range 0.5-200: an object hides
    below this size on screen (CSS px);
  - `crowdPx` - `globeCrowdPx`, default 24, range 0-500: a station pin
    hides when its nearest neighbour on screen is closer (0 turns the
    crowding off);
  - `meteorDeg` - default 20, range 10-89: the angle the meteor enters at,
    below the tour's horizon (the lab's default is 30; 10 is the lab's
    floor, so no value outside what the lab's sweeps cover is read);
  - `meteorLandDeg` - default 50, range 10-85, read as at least
    `meteorDeg`: the angle it lands at, held over the final stretch
    (inside 45-60, steep enough to see the tour from close);
  - `landAglM` - default 150, range 30-5000: the landing's height over
    the tour's ground (about 200 m from the tour at 50 degrees: the
    stations' pins and rings fill the view);
  - `startKm` - default 8000, range 500-65000: the start height (the
    whole hemisphere in view; 65000 starts with the whole Earth small).
- `readGlobeSwitch(search)` -> `GlobeSwitch` (`on`, `hidePx`, `crowdPx`,
  `meteorDeg`, `meteorLandDeg`, `landAglM`, `startKm`)
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
for `globe=1`, every knob read, a landing never shallower than the
entry, a bad or out-of-range knob read as its default, the bounds
themselves accepted, the defaults inside their ranges.
