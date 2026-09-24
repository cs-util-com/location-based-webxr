# `ar/sun-check.ts`

## Purpose

The AR sun check's controller (plan
`GpsPlusSlamJs_Docs/docs/2026-09-24-0100-ar-sun-overlay-heading-check-plan.md`,
M2, §3.4): keeps the sun marker (`ar/sun-marker.ts`) on the real, apparent
sun, and turns "aim the centre at the sun, press Mark" into a measured
heading error for an app to show or log.

## Public API

- `startSunCheck(deps)` → `SunCheck`. `deps`:
  - `scene` — the GPS-world NUE root (the marker is added here);
  - `arWorldGroup` — the group carrying the alignment;
  - `getZeroReference()` — the place the sun is computed for, or `null`;
  - `getTargetYawDeg?()` — the app's target alignment yaw, if known;
  - `nowEpochMs()` — the wall clock (production: `Date.now`);
  - `monotonicEpochMs?()` — default `performance.timeOrigin + now()`;
  - `refraction?` — air conditions (default standard air).
- `SunCheck`:
  - `marker`;
  - `status()` → `{ visible, hiddenBecause?: 'no-position' | 'no-alignment'
| 'sun-down', sunAzDeg?, sunElDeg? }` (a HUD line);
  - `mark()` → `Promise<SunMarkResult>`: `{ ok: true, sighting, warnings }`
    or `{ ok: false, reason }` with `reason` one of the hidden reasons,
    `'busy'`, `'moved'`, `'no-frames'`, `'disposed'`. Always resolves.
    Warnings: `'high-sun'` (above 35°), `'target-changed'`;
  - `dispose()` — also runs on AR session teardown.
- `SunSighting` — the flat record the recorder logs (plan §6.3): the median
  alignment-free ray in the WebXR reference space, the middle frame's camera
  orientation (AR-odometry NUE) and projection entries, the drawn yaw
  (median, min, max) and the target yaw with a changed flag, the place, the
  apparent sun and its refraction, the clock offset, and the derived median
  heading / elevation errors and separation.
- **Exported today: `startSunCheck`, `SunCheck`, `SunCheckDeps`, `SUN_CHECK`.** The result and status types (`SunMarkResult`, `SunSighting`, `SunMarkRefusal`, `SunMarkWarning`, `SunCheckStatus`, `SunHiddenReason`) are module-internal until the RecorderApp wiring imports them (the dead-code check refuses unused exports); callers can name them through `SunCheck` meanwhile, e.g. `Awaited<ReturnType<SunCheck["mark"]>>`.
- `SUN_CHECK` — the rules: a 1 s window, 300 ms past the tap, ≥ 10 frames,
  spread ≤ 0.3° (80th percentile), give up 1.5 s after the window, hide
  below −1°, Mark from 0°, high sun above 35°, sun recomputed every 250 ms.

## Invariants & assumptions

- **Sampled where it is drawn**: in the marker's `onBeforeRender`, with the
  camera three renders it with, so the drawn ray and the alignment-free ray
  come from one frame whatever order the app's frame callbacks run in (plan
  review finding 3). Only drawn frames count: a hidden marker samples
  nothing.
- **Each sample carries the sun at its own instant** (the marker's sun is up
  to 250 ms old; the sun moves up to ~0.004°/s).
- **The window is the second BEFORE the press** when frames cover it (the
  tap jolts the phone; review finding 5); otherwise the second starting
  300 ms after it.
- **The spread is measured on the alignment-free ray** (review finding 4),
  as the 80th-percentile distance from the median direction: an alignment
  update mid-window is flagged, not refused, and a two-cluster shake cannot
  hide behind a median (a test showed the median distance reading 0 for
  16 frames one way and 15 the other).
- **The marker is hidden, and a Mark refused, without a position, before
  the first alignment (the group still the identity), and with the sun
  down** (below −1° hidden, below 0° no Mark).
- The clock is injected; production passes `Date.now`, never the XR clock,
  which stalls while the phone sleeps (review finding 1). Each sighting
  logs `nowEpochMs − monotonicEpochMs`.
- Sampling skips a degenerate alignment or a non-perspective view rather
  than throwing inside the render loop.

## Examples

```ts
const check = startSunCheck({
  scene,
  arWorldGroup,
  getZeroReference: () => store.getState().zeroReference,
  nowEpochMs: Date.now,
});
const result = await check.mark();
if (result.ok) log(result.sighting);
```

## Tests

`sun-check.test.ts` (jsdom, the REAL `createSceneHierarchy`, an injected
clock): hidden until an alignment exists and below −1° (with the reason);
the marker on the APPARENT sun (the refraction wiring); an injected yaw
error of 2.5° read back through the render-time chain; a shaking phone
refused; an alignment change mid-window flagged with the yaw range; the
post-press window past the tap; busy and disposal (never hangs); refusals
without an alignment or with the sun down; "no-frames" when nothing
renders; the high-sun warning; session teardown.
