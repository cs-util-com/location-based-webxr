# globe-switch.ts

## Purpose

The link switch for the desktop editor's 3D view on the full globe, its
default, and the knobs tuned by eye: the globe's
visibility rule (`../editor3d/globe-visibility.ts`) and the approach's
meteor (`../editor3d/globe-approach-meteor.ts`). `edit.html?globe=0`
opens the older 3D view (OrbitControls over a local ground) instead.

**Temporary:** `globe=0` exists only until the older 3D view and the 2D
map are removed from the editor; the e2e specs of those views open with
it. An old `globe=1` link keeps opening the globe.

## Public API

- `GLOBE_SWITCH` - `param` `"globe"`; the knobs (`GlobeSwitchKnob`:
  `param`, `fallback`, `min`, `max`):
  - `grade` - `grade`, no default here: the colour grade's name, handed on
    as the link wrote it (`grade: string | null` in `GlobeSwitch`). This
    module carries none of the globe's code, so the Globe package's
    `resolveGlobeGrade` judges the name when the view opens: an unknown
    one is the default with a console warning;
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
  - `dust` - default 1, range 0-1: the speed streaks on the approach (the
    globe lab's speed dust in its look); `dust=0` is the A/B link that
    turns them off;
  - `osmGain` - default 0.55, range 0.2-1: the street map's darkening
    gain (its luma compressed toward it, `patchOsmFade` in the Globe
    package), so the map's bright tiles do not show the fade's edge as a
    pale disc; the link's value is its A/B switch. Measured by a
    browser spec since retired (its parsing is held by
    `globe-switch.test.ts`, its effect by the Globe package's
    `globe-osm-overlay.test.ts`) (2026-11-03, the
    map's land colour over the globe's imagery, the step at the fade's edge
    as the ratio of the mapped ground's luma to the bare ground's, 69 of
    255): gain 1 3.40, 0.7 3.00, 0.6 2.81, 0.55 2.71, 0.5 2.60, 0.45 2.48.
    The ratio falls evenly with the gain, so no value is singled out by it:
    0.55 cuts the step by a fifth and keeps the paper at 186 of 255 (233
    at gain 1), still read as a light map; the choice stays a look one, for
    the phone A/B.
- `osmGainMode` (`param`, `fallback` "flat", no range): how the gain
  darkens the map. "flat" multiplies its colour, which keeps its
  contrasts (roads and names against the land, as the tile server drew
  them); `osmGainMode=compress` compresses its luma, the A/B that lowers
  them (the measurement above was taken in that mode). Anything but
  exactly "compress" reads as "flat".
- `cloudShadow` - default 0.3, range 0-1: the clouds' shadow strength,
  the shell's own on the relief and the ground's soft one from orbit
  (`GlobeViewCloudsOptions.shadow`); the lab's 0.5 and 0.6 darkened the
  landing too much. `cloudShadow=0.45` / `0.6` are the A/B links.
- `cloudWind` - default 40, range 0-1000 (m/s): the clouds' wind floor
  (`globeEditorSettings({ windMps })`), how fast the cloud field drifts at
  the least, which is what is seen near the ground. The globe's own 10
  read as static clouds at the landing: a cloud at 3 km moves 30 m in 3 s
  (0.6 degrees seen from 150 m up, 9.0e-5 deg/s of longitude, measured by
  `playwright-tests/editor3d-globe-clouds.spec.js`, 2026-11-03); 40 moves
  it 120 m. `cloudWind=10` (the old look) / `80` are the A/B links.
- `buildings` - default 1, range 0-1: the OSM buildings (with their trees
  and roads) at the tour (`../editor3d/editor3d-globe-city.ts`).
  `buildings=0` is a developer's link: no city worker is made and nothing
  is asked of Overpass (`stats().city` reads null), the other half of a
  frame-time comparison.
- `startKm` (a `GlobeSwitchOverride`: `param`, `min`, `max`, no default) -
  range 500-65000 km: the start height as an explicit override. Without
  it (`null`) the meteor starts where the globe lab's intro zooms out to
  at the page's aspect (about 43,600 km on a landscape screen, more on a
  portrait phone; `../editor3d/globe-approach-meteor.ts`).
- `readGlobeSwitch(search)` -> `GlobeSwitch` (`on`, `hidePx`, `crowdPx`,
  `meteorDeg`, `meteorLandDeg`, `landAglM`, `startKm` (number or null),
  `dust`, `osmGain`, `osmGainMode`, `cloudShadow`, `cloudWind`, `buildings`)
  from a link's query, with or without its "?".

## Invariants & assumptions

- **On unless turned off:** only `globe=0` turns it off (`1`, `true`,
  `yes`, empty, no value: on), so an old `globe=1` link still opens
  the globe.
- **A typo never breaks the view:** a knob that is empty, not a number,
  not finite or outside its range reads as its default (an override as
  none).
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

`globe-switch.test.ts`: on with its defaults without the switch, off only
for `globe=0`, every knob read, a landing never shallower than the
entry, a bad or out-of-range knob read as its default, `startKm` read
as an override only, the streaks on by default and off for `dust=0`, the buildings on by
default and off for `buildings=0`, the
street map's gain at 0.55 by default and its range, the bounds themselves
accepted, the defaults inside their ranges.
