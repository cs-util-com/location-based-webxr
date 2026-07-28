# slider-scroll-guard.ts

## Purpose

Stops a native `<input type="range">` from editing its value when the user is
merely scrolling past it with a finger. Only two touch interactions change a
value: an **explicit horizontal drag**, and a **short tap** committed on release.
Vertical swipes — and slow presses that could be the start of one — leave the
value exactly as it was.

Motivated by field feedback (2026-07-27): the recorder settings panel scrolls
vertically and its full-width sliders sit under the swiping finger, so ordinary
scrolling silently rewrote recording settings. Used by the recorder settings
modal and by the PhysicsDemo / WayfindingHudDemo control panels.

## Public API

- `guardSliderAgainstScroll(input: HTMLInputElement): () => void`
  - Installs the guard on one range input; returns a disposer that removes every
    listener and restores plain browser behaviour.
  - No error modes: any input element is accepted (guarding a non-range input is
    harmless but pointless), and the guard never throws.

Two feel constants are module-private on purpose — they are not knobs callers
should tune per slider: `GESTURE_INTENT_PX = 10` (travel before a gesture's
direction is trusted) and `TAP_MAX_MS = 300` (longest press still read as a tap).

## Behaviour

Per touch/pen gesture the guard tracks an intent:

- `undecided` — below the threshold in both axes. Value changes are **reverted**
  and the `input`/`change` events are stopped (`stopImmediatePropagation`), but
  the suppressed value is remembered in case the gesture turns out to be a tap.
- `horizontal` — `|dx| >= 10` **and** `|dx| > |dy|`. The guard steps aside for
  the rest of the gesture; the native slider behaves normally.
- `scroll` — `|dy| >= 10` **and** `|dy| >= |dx|`. **Sticky**: a long swipe that
  drifts sideways can never turn into a value change.

On release the guard decides:

- `pointerup` while still `undecided`, within `TAP_MAX_MS` of pointer-down →
  **tap**: the suppressed value is re-applied and fresh `input` + `change` events
  are dispatched so the application sees the edit.
- anything else (`pointercancel`, a slow press, a scroll) → the start value is
  restored and nothing is dispatched.

## Invariants & assumptions

- **Registration order matters.** Install the guard _before_ the application's
  own `input` listener on the same element: at-target listeners fire in
  registration order, which is what lets `stopImmediatePropagation()` shield the
  later listener.
- The value captured on `pointerdown` is the value **before** Blink's
  jump-to-position default action, because listeners run before default actions.
- Gesture duration is read from `event.timeStamp` (same time origin for
  pointer-down and pointer-up), never from a wall clock.
- Only the pointer that started the gesture can decide or end it; a second finger
  is ignored. Touch pointers are implicitly captured, so the end event is
  guaranteed — but if the _same_ pointer starts again the guard re-arms rather
  than staying frozen (a stuck slider would be worse than the original bug).
- `pointerType === 'mouse'` is never guarded (desktop click-to-set is expected
  behaviour); an unknown `pointerType` is treated as touch.
- Events dispatched with **no gesture in flight** (keyboard, programmatic
  `input`) always pass through untouched.
- Pairs with `input[type='range'] { touch-action: pan-y; }` in the host app's
  stylesheet, which is what makes the browser actually perform the scroll. CSS
  alone cannot undo the pointer-down write.

## Examples

```ts
import { guardSliderAgainstScroll } from 'gps-plus-slam-app-framework/utils/slider-scroll-guard';

const slider = document.getElementById('images-interval') as HTMLInputElement;
const dispose = guardSliderAgainstScroll(slider); // BEFORE the app listener
slider.addEventListener('input', () => applyValue(Number(slider.value)));

// later, when tearing the view down:
dispose();
```

## Tests

- [`slider-scroll-guard.test.ts`](slider-scroll-guard.test.ts) — vertical swipe
  keeps the value, sticky scroll lock, horizontal drag passes through, tap
  commits on release, slow press and `pointercancel` do not, no commit while the
  gesture is in flight, mouse untouched, non-gesture events, multi-touch,
  re-arming after a lost `pointerup`, disposer (which doubles as the unguarded
  bug reproduction).
- [`slider-scroll-guard.property.test.ts`](slider-scroll-guard.property.test.ts)
  — random gesture paths: vertical-dominant swipes never edit, clearly
  horizontal drags always apply, gestures slower than the tap window only edit
  when horizontal, state is always released.
- Gesture simulation lives in
  [`../test-utils/pointer-gestures.ts`](../test-utils/pointer-gestures.ts)
  (jsdom has neither `PointerEvent` nor native range-input behaviour).
- Consumer-level coverage: the recorder's `settings-modal.test.ts`, the
  PhysicsDemo's replay-speed slider test and the WayfindingHudDemo's HUD-controls
  test.
