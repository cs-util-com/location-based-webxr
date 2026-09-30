# slider-scroll-guard.ts

## Purpose

Stops a native `<input type="range">` from editing its value when the user is
merely scrolling past it with a finger. Only two touch interactions change a
value: an **explicit horizontal drag**, and a **short tap** committed on release.
Vertical swipes — and slow presses that could be the start of one — leave the
value exactly as it was.

Motivated by field feedback (2026-07-27): the recorder settings panel scrolls
vertically and its full-width sliders sit under the swiping finger, so ordinary
scrolling silently rewrote recording settings. Generalised after the owner's
report of 2026-09-30 (every demo page's control panel had the same trap): each
page now installs it ONCE, for the whole document.

Used by every page with a slider: the RecorderApp, the OsmDemo, the PhysicsDemo
and the WayfindingHudDemo (each in its `main.ts`), and the design system's
look-dev page and labs (`3d/panel.js`, `labs/ar-shadows/ar-shadows-lab.js`,
fetched as type-stripped TypeScript over the `/fw/` route). The root test
`tests/repo-config/slider-pages-load-the-guard.test.js` holds every page with a
range input to it.

## Why the browser's own behaviour is the problem (Chromium, 2026-09-30)

- `SliderContainerElement::HandleTouchEvent` (Blink,
  `slider_thumb_element.cc`) moves the thumb to the finger on **`touchstart`**,
  before any direction is known, and fires `input`.
- It locks its OWN drag direction on the **first `touchmove`**, with no
  threshold (`|dx| >= |dy|` is horizontal). By the source, a scroll whose
  first move reaching Blink is sideways is "horizontal" to it, and it keeps
  writing the value on every later `touchmove` while the page scrolls, then
  fires `change` on `touchend`. **Not reproduced in headless Chromium
  (2026-09-30):** without the guard, a swipe starting with a 3 px twitch
  showed only the touch-down jump, and 11 touchmoves after the
  `pointercancel` wrote nothing (the twitch is probably inside the browser's
  touch slop, so Blink never sees it). The guard's hold until `touchend`
  (below) is therefore a defence, not a measured fix.
- **Measured (headless Chromium with touch emulation, 2026-09-30):** without
  the guard every vertical swipe starting on a look-dev slider moved it from
  5 to 62 on touch-down and fired one `input` and one `change`, while the
  plate scrolled ~150 px. With the slider's page CSS set to
  `touch-action: auto` it still scrolled 153 px: Chromium's own `pan-y` is
  real.
- Blink's style adjuster already gives a horizontal slider's container
  `touch-action: pan-y` (`AdjustSliderContainerStyle`), so a vertical swipe
  does scroll; CSS cannot undo the touch-down write.
- WebKit on iOS only drags from the thumb (its `SliderThumbElement` touch
  handlers ignore the track); not verified on a device.

## Public API

- `guardSlidersIn(root: Document | Element, tuning?): () => void`
  - Guards every range input under `root` (the root included), including inputs
    added later. Pages call it once: `guardSlidersIn(document)`.
  - Returns a disposer. Installing twice on the same root shares one install
    (so a tap is never replayed twice); the listeners go when the last disposer
    runs; a disposer called twice is a no-op.
  - No error modes; never throws.
- `guardSliderAgainstScroll(input): () => void` - **deprecated**, equal to
  `guardSlidersIn(input)`. Kept for external callers; no page in this repo uses
  it (the repo-config test keeps it that way, since a per-slider install under
  a page-wide one would double-guard).
- `SLIDER_GUARD_TUNING` (`{ intentPx: 12, horizontalMaxDeg: 45, tapMaxMs: 300 }`,
  frozen) and the `SliderGuardTuning` type. The `tuning` parameter exists for
  the threshold sweep; pages use the default and never tune it per slider.

## Behaviour

Per touch/pen gesture the guard tracks an intent:

- `undecided` — below `intentPx` in both axes. Value changes are **reverted**
  and the `input`/`change` events are stopped (`stopImmediatePropagation`), but
  the suppressed value is remembered in case the gesture turns out to be a tap.
- `horizontal` - the dominant axis reached `intentPx` and the gesture is less
  steep than `horizontalMaxDeg` (default 45: `|dx| > |dy|`). The guard steps
  aside for the rest of the gesture; the native slider behaves normally.
- `scroll` - the dominant axis reached `intentPx` at `horizontalMaxDeg` or
  steeper. **Sticky**: a long swipe that drifts sideways can never turn into a
  value change.

On release the guard decides:

- `pointerup` while still `undecided`, within `tapMaxMs` of pointer-down →
  **tap**: the suppressed value is re-applied and fresh `input` + `change` events
  are dispatched so the application sees the edit. (Chromium then fires its own
  trusted `change` on `touchend` with the same value.)
- `pointercancel` (the browser took the gesture over for scrolling) → the start
  value is restored. When a `touchstart` for the gesture reached the slider, the
  guard **keeps holding** the slider (intent `scroll`) until that touch
  sequence's `touchend`/`touchcancel` on the slider, because by Blink's source
  it can keep writing the value after the pointer was cancelled (see above; a
  defence the headless run did not show to be needed). Without touch events
  the gesture ends at the cancel.
- anything else (a slow press, a scroll ended by `pointerup`) → the start value
  is restored and nothing is dispatched.

## Invariants & assumptions

- **Capture phase.** Every listener sits in the capture phase on `root`, so the
  guard runs before any listener on the slider itself, whatever the
  registration order. On `document`, a page's own `window` capture listener
  would still run first (none exists here).
- The value captured on `pointerdown` is the value **before** Blink's
  jump-to-position default action (pointer events fire before the touch
  event whose default action writes it).
- Gesture duration is read from `event.timeStamp` (same time origin for
  pointer-down and pointer-up), never from a wall clock.
- One gesture at a time per install. Only the pointer that started it can
  decide or end it; a second finger is ignored. If the SAME pointer starts
  again (a lost end event), or any pointer starts while the guard only waits
  for a cancelled touch to end, the guard re-arms rather than staying frozen (a
  stuck slider would be worse than the original bug).
- `pointerType === 'mouse'` is never guarded (desktop click-to-set is expected
  behaviour); an unknown `pointerType` is treated as touch.
- Events with **no gesture in flight** (keyboard, programmatic `input`) always
  pass through untouched, and so do events of a slider other than the one under
  the finger.
- Range inputs inside a shadow root are not reached from `document` (their
  events are retargeted to the host); install on the shadow root for those.
- The module imports nothing, so the no-build design-system pages can fetch it
  as type-stripped TypeScript (pinned by the repo-config test).
- `input[type='range'] { touch-action: pan-y; }` in a page's stylesheet is
  belt and braces for engines other than Chromium, which applies it itself.

## Threshold sweep (2026-09-30, `slider-scroll-guard.sweep.test.ts`)

The real guard, over `intentPx` 4-16 px x `horizontalMaxDeg` 30-60 degrees, on
three gesture families: scroll swipes leaning 0-40 degrees off vertical (with
and without a 3 px sideways twitch first), horizontal drags leaning 0-35
degrees, and 90 ms taps wandering 0-8 px.

- **4-8 px** lose taps whose finger wanders vertically by the threshold or
  more (the tap becomes a scroll and is discarded).
- **30 degrees** loses drags leaning 25-35 degrees (4 px), 30-35 degrees
  (6-10 px) or 35 degrees (12-16 px).
- **52.5 degrees** lets scroll swipes edit from a 25-35 degree lean (the
  larger the threshold, the steeper); **60 degrees** from 20-25 degrees.
- **10 px / 45 degrees** (the rule until 2026-09-30) held every family except
  one case: a swipe leaning 40 degrees off vertical that starts with a sideways
  twitch. 12 px at 45 degrees, or 37.5 degrees at 10 px or more, clears it.
- **Shipped: 12 px / 45 degrees** (owner decision 2026-09-30). Holds every
  family, and so do its neighbours 14-16 px at 45 degrees and 12-16 px at
  37.5 degrees; the sweep test pins it.

## Tap-window sweep (2026-09-30, same file)

`tapMaxMs` over 150, 200, 250, 300, 400, 500, 600 and 800 ms, and with no
window at all, at the shipped 12 px / 45 degrees (review 2026-09-30, A2).
Families: scrolls that start with a still dwell of 0-800 ms, leaning 0-40
degrees off vertical, ended by `pointercancel` or by a lift; still presses the
browser cancelled; presses of 60-1000 ms the browser never cancelled,
standing still or wandering 6 px; and a 10 px vertical creep the browser never
cancelled (below `intentPx`, so the direction rule cannot see it).

- **At every window, and with none, no scroll and no cancelled press edits.**
  The direction rule and the browser's `pointercancel` stop every scroll;
  the window is not what keeps the reported bug fixed.
- **What the window does:** it discards a press the browser never took over
  exactly when the press outlasts it, whether the finger stood still,
  wandered, or crept 10 px vertically. At 300 ms the 400-1000 ms presses are
  lost; at 800 ms only the 1000 ms one; with no window none.
- **Kept at 300 ms.** Whether a hold that never became a scroll should set
  the value is a product decision, not a measurement: "a short tap still sets
  the value, a longer hold does not" is the owner's decision of 2026-07-28
  (`2026-07-27-2349-settings-slider-scroll-gesture-plan.md`, "Tap
  handling"). The sweep removes its stated reason ("a hold is how a scroll
  begins": a hold that turns into a scroll is caught without the window), so
  the question is back with the owner.

## Examples

```ts
import { guardSlidersIn } from 'gps-plus-slam-app-framework/utils/slider-scroll-guard';

// once, in the page's entry module
guardSlidersIn(document);
```

```js
// a no-build design-system page, over the dev server's /fw/ route
import { guardSlidersIn } from '/fw/utils/slider-scroll-guard.js';
guardSlidersIn(document);
```

## Tests

- [`slider-scroll-guard.test.ts`](slider-scroll-guard.test.ts) - the whole
  contract under both installs (one slider, the whole document): vertical swipe
  keeps the value, sticky scroll lock, horizontal drag passes through, tap
  commits on release, slow press and `pointercancel` do not, no commit while
  the gesture is in flight, mouse untouched, non-gesture events, multi-touch,
  re-arming after a lost `pointerup`, the hold after `pointercancel` until the
  touch ends (and its release, and its re-arming), the disposer (which doubles
  as the unguarded bug reproduction). Page-wide only: sliders created later,
  a listener registered before the install, other inputs untouched, shared
  installs.
- [`slider-scroll-guard.property.test.ts`](slider-scroll-guard.property.test.ts)
  — random gesture paths: vertical-dominant swipes never edit, clearly
  horizontal drags always apply, gestures slower than the tap window only edit
  when horizontal, state is always released.
- [`slider-scroll-guard.sweep.test.ts`](slider-scroll-guard.sweep.test.ts) -
  the threshold sweep and the tap-window sweep above; prints both tables,
  asserts the shipped rule and, at every window, that no scroll edits and
  that exactly the presses longer than the window are discarded.
- Gesture simulation lives in
  [`../test-utils/pointer-gestures.ts`](../test-utils/pointer-gestures.ts)
  (jsdom has neither `PointerEvent` nor native range-input behaviour).
- In a browser: `GpsPlusSlamJs_DesignSystem/3d/slider-touch.smoke.spec.mjs`
  drives CDP touch events on the look-dev plate (headless Chromium with touch
  emulation, not a phone).
- Consumer-level coverage: the recorder's `settings-modal.test.ts`; the root
  `tests/repo-config/slider-pages-load-the-guard.test.js` for every page.
