# `src/sun-follow.ts`

## Purpose

The page's sun follower: the one place the 3D view follows the store's sun
(`selectSun`) and look weights (`selectLookWeights`), and the one holder of the
sun drivers' timers (`sun-driver.ts`). It replaced closures in `main.ts`, so
its rules run in the unit suite against the real store.

## Public API

- `createSunFollow(deps): SunFollow`, with `deps`:
  - `store` (the demo store), `view` (`SunFollowView`, the `BuildingView`
    members it drives: `drawsBlend`, `setLookWeights`, `followMeshScheme`,
    `setSunAndLight`, `atNextFrame`);
  - `dialog()` (the light dialog, read late because it is created after the
    follower: `settings`, `defaults`, `touched`, `refresh`);
  - `sunAngles(instantMs, place)`, `showSun()` (paints the sun controls);
  - optional `drivers.clock` / `drivers.timelapse(seconds)` and `now()`, the
    test seams (the real drivers and `Date.now` by default).
- `SunFollow`:
  - `viewLight(settings)`: the light for the dialog's settings. A fixed
    build takes them as they are (`rigLightOf`); the blend mixes each look's
    light, the fields the viewer set kept (`lookLightSettings`,
    `blendLookLight`), by the store's look weights.
  - `step()`: THE SUN STEP now: one `view.setSunAndLight`, `showSun()`, and
    the dialog's `refresh()` unless the timelapse plays.
  - `followMeshScheme(scheme)`: a full mesh arrived; the view follows its
    scheme with the store's weights, and when that turns the drawn city into
    the blend or back, one step re-lights it.
  - `moveSun(instantMs)`: a hand on the time controls. Stops the driver,
    drops a pending sampled step, then dispatches `sunMoved`.
  - `placeMoved(place)`: a re-anchor. Keeps the driver. Under the real clock
    the sun goes straight to `clockInstant(now(), place)`; otherwise the
    sun's local time is kept (`relocate`).
  - `start(choice)`: stops any driver, records the kind in the store
    (`sunDriverChanged`) and starts it with the store's dispatch and state.
  - `dispose()`: unsubscribes and stops.
- `SUN_STEP_TIMELAPSE_MS` (250): the timelapse's step interval.

## Invariants & assumptions

- **Which driver runs is store state** (`selectSunDriver`, `osm-store.ts`);
  the driver's stop function, the throttle and the queued frame task are
  resources and stay in the closure. Every stop puts `"none"` back.
- **One store subscription**: new weights go to the view only while it draws
  the blend (`view.drawsBlend`, which is `CityLook.lookWeights !== undefined`,
  so it cannot drift from what is drawn); a new sun steps at once, or, while
  the timelapse plays, at most every 250 ms and once after the last move
  (the trailing throttle), queued with `view.atNextFrame` so the step's sky
  readback runs at the start of a frame rather than from a bare timer.
- **A hand wins over a driver, a re-anchor does not.** Without the drop in
  `moveSun`, a sampled step queued before the hand would run after it and
  repaint with the driver's last light.
- **No dialog readback while the timelapse plays**: `refresh()` is a GPU
  readback while the dialog is open, paid per step for a readout nobody reads
  while the sun runs.

## Examples

```ts
const sunFollow = createSunFollow({
  store,
  view: buildingView,
  dialog: () => lightDialog,
  sunAngles: sunAnglesAt,
  showSun: () => showSunControl(),
});
sunFollow.start(sunDriver); // from the link: none, clock or timelapse
slider.oninput = () => sunFollow.moveSun(instantFromSlider());
```

## Tests

`sun-follow.test.ts` (fake view, dialog and drivers, the real store, fake
timers): the light for a fixed build and for the blend; a step at once with
the readout when no driver runs; the timelapse's sampled step queued into the
next frame, without the readout; the weights reaching the view only for the
blend; one step when the drawn city turns into the blend or back; a hand that
stops the driver and drops its pending step; a re-anchor that keeps the
driver and the sun's phase, and under the clock goes to the clock's instant
there; no driver for none, and dispose stopping a running one. A hand
mutation pass killed: no stop in `moveSun`, `viewLight` ignoring
`drawsBlend`, the inverted timelapse check, an unconditional
`setLookWeights`, no dropped pending step.
