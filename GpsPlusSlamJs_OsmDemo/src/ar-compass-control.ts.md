# `ar-compass-control.ts`

## Purpose

The compass-influence slider inside the AR overlay (DEC-E2) — the DOM surface
for the 0–1 influence whose mapping lives in `compass-influence.ts`.

## Public API

- `createArCompassControl(options) → ArCompassControl`
  - `options.root` — **the SAME element passed to `initAR`** (`#ar-root`).
  - `options.onChange(settings)` — called only when the settings can actually
    take effect.
  - `options.initialInfluence` — defaults to `COMPASS_INFLUENCE_DEFAULT`.
- `ArCompassControl`
  - `attach()` / `dispose()` — idempotent.
  - `influence(): number` — current value, 0–1.
  - `setReady(ready)` — whether the store can accept settings. The first `true`
    **flushes a latched value**.

## Invariants & assumptions

- **It stays OUT of `#ar-root` until `attach()` and removes itself on
  `dispose()`.** That element is `position: fixed; inset: 0` and hidden only
  while `:empty`, so anything left attached keeps a full-viewport layer over the
  page whenever AR is not running — a regression that has shipped here once.
- **Every compass setter is a silent no-op before `setZeroPos`** — the reducer
  returns state unchanged while `gpsData` is null. So the control is **disabled
  until `setReady(true)`**, and a change made before then is **latched and
  re-applied**, never dropped. A slider that accepts a drag and discards it
  leaves the UI and the store disagreeing for the rest of the session with
  nothing on screen saying so.
  - In practice `ar-mode.ts` calls `setReady(true)` immediately, and that is a
    fact rather than an assumption: AR entry is gated on `canEnterAr(origin)`,
    and a non-null origin **is** the framework's `zero`. The latch remains for
    any future caller not gated the same way.
- **`setReady(true)` twice does not re-dispatch.** It is called per fix in some
  wirings, and re-applying each time would dispatch four settings once a second.
- **It listens to `input`, not `change`.** A range control fires `change` only
  when the finger lifts, which would leave the readout lagging the thumb.
- **It says why it looks unresponsive**, in two states: `waiting for a GPS fix`
  before readiness, and `takes ~15–30 fixes to express` after — the applied
  bearing is smoothed at `coldStartSnapAlpha = 0.15` per GPS event. An
  instrument that looks broken for half a minute gets dragged again, which
  restarts the smoothing.
- **The slider carries an `aria-label`** (`#ar-root` is no longer inert, r510
  review) and the value readout is an `aria-live="polite"` region — it changes
  only on a drag, unlike the HUD.
- CSS classes are **kebab-case, not BEM** — the gate's `lint:css` enforces
  `selector-class-pattern`. Styles live in `index.html` beside the other AR
  overlay classes.

## Examples

```ts
const compass = createArCompassControl({
  root: arRootElement,
  onChange: (settings) => {
    store.dispatch(
      setCompassRotationPriorEnabled(settings.rotationPriorEnabled),
    );
    store.dispatch(
      setColdStartOverrideEnabled(settings.coldStartOverrideEnabled),
    );
    store.dispatch(setCompassExperimentEnabled(settings.experimentEnabled));
    store.dispatch(setCompassVoteWeight(settings.voteWeight));
  },
});
compass.attach();
compass.setReady(true); // safe: AR entry already required a fix
```

## Tests

`ar-compass-control.test.ts` (jsdom) — overlay-root discipline, idempotent
attach/dispose, the default, the disabled-and-explained state before readiness,
the latch-and-flush, no re-dispatch on a repeated `setReady`, the full silencing
combination at zero, reporting during a drag rather than on release, both ends
being named, the smoothing warning, and the accessible name.

## Related

- `compass-influence.ts` — the mapping and its reasoning.
- `ar-elevation-control.ts` — the sibling control; same `#ar-root` discipline.
- `ar-measurements.ts` — `fusedBearingDeg` is what makes this slider observable,
  and `ar-origin.ts`'s `nueBearingDeg` carries the axis convention it needs.
