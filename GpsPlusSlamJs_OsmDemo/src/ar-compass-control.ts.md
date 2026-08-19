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

- **IT SITS AT THE TOP OF THE OVERLAY, in `#ar-root`'s column** (round three,
  G9, DEC-W5), under the HUD readout and above nothing. It used to be
  `bottom: 20vh`, centred and up to 88vw wide — the thirteenth session's report
  was that it "occludes basically the AR 3D content", which at that width and
  position it did.
  - **A COLUMN, NOT A SECOND OFFSET.** Moving it to a `top:` value would have
    put two hard-coded offsets in the same corner, one of which changes height
    at runtime — this box wraps and carries a hint line. That is exactly how the
    earlier overlap with `.ar-toast` happened (PR #311 review, finding 4), so
    the relationship is now a property of the layout rather than of two numbers
    agreeing.
  - **THE COLUMN IS `.ar-stack`, A BOX `ar-mode.ts` OWNS — not `#ar-root`
    itself**, and the first attempt got that wrong in a way no test could see.
    `#ar-root` also holds **the framework's full-screen WebGL canvas**, inserted
    as its first child, in flow, with an inline 100vh height — so making that
    element the flex column turned the canvas into an unshrinkable first item
    and pushed this control and the readout a full viewport below the fold, for
    the whole session. The other children (`.ar-toast`, `.ar-elevation`, the
    framework's CSS3D overlay) are absolutely positioned and were never
    affected. The AR offer is not in `#ar-root` at all — it is a fixed element
    in `<main>`, because it exists precisely when no session is running.
  - **The old 20vh had a real reason and it is retired, not forgotten:** it
    avoided `.ar-toast`'s 12vh band, because the far-travel toast fires at 2 km,
    during exactly the long walk this slider is measured on. Leaving the bottom
    of the screen entirely means there is nothing down there to collide with.
  - **The class name `.ar-compass` is a contract with the stylesheet**, and the
    e2e that measures the placement attaches its own element carrying it —
    because a real AR session is unreachable in headless Chromium. What keeps
    the two in step is this module's own test asserting the class it builds.
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

## The initial value is dispatched too (PR #311 review, finding 2)

`pending` starts **`true`**, so the first `setReady(true)` applies whatever the
control is showing even if nobody has dragged it.

Before that fix the readout said `compass 0.10` while the store still held the
**library defaults** — and those differ in kind, not merely in degree:
`coldStartOverrideEnabled` defaults **on**, while `compassSettingsFor` clears it
at _every_ slider position precisely so the slider is the thing being measured.
A session that never touched the control was therefore measuring settings the UI
did not describe, and its field notes would have looked like data.

This also blunts a related gap the same review noted: `release()` does not
restore the four settings on session end, so a slider left at 0.5 leaves
`coldStartOverrideEnabled: false, experimentEnabled: true` behind. Harmless while
the fusion only runs during an AR walk, and the next session now re-dispatches
its own starting value at entry rather than inheriting the last one silently.
