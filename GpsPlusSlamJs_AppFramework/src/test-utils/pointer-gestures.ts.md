# Pointer Gesture Simulation Helpers

## Purpose

jsdom implements neither `PointerEvent` nor the native behaviour of
`<input type="range">`. Touch-gesture tests therefore have to synthesize both —
the pointer stream **and** the value writes a real browser performs. These
helpers keep that simulation in one place so every consumer of
[`../utils/slider-scroll-guard.ts`](../utils/slider-scroll-guard.ts) agrees on
what "a swipe" and "a tap" mean.

## Public API

- `createPointerEvent(type, init?) → Event`
  - Builds a pointer event from `MouseEvent` (which already carries
    `clientX`/`clientY`) plus `pointerType` (default `'touch'`), `pointerId`
    (default `1`) and an optional `timeStamp` override.
- `applyNativeSliderValue(input, x) → void`
  - The value write a native range input performs for a pointer at `x`: sets
    `input.value = String(x)` and dispatches a bubbling `input` event.
- `simulateNativeSliderGesture(input, path, options?) → void`
  - Drives a full gesture: `pointerdown` **plus an immediate value write** (Blink
    jumps the thumb to the finger before any scroll intent is known), a
    `pointermove` + write per further point, then `pointerup` (or `pointercancel`
    with `{ end: 'cancel' }`, which is what the browser sends when it takes the
    gesture over for scrolling).
  - `options.pointerType` defaults to `'touch'`; `options.durationMs` defaults to
    1000 ms — deliberately above any tap window, so a gesture only counts as a
    tap when a test says so.
  - Throws if `path` is empty.

## Invariants & assumptions

- A point's `x` coordinate doubles as the value the browser writes, which keeps
  assertions readable (`{ x: 80 }` ⇒ value `'80'`) — pick coordinates inside the
  slider's `min`/`max` unless clamping is the point of the test.
- Event timestamps are synthetic and spread evenly across `durationMs`, so tap
  -vs-press behaviour is deterministic instead of depending on how fast the test
  machine dispatches events.
- The simulation models Blink's jump-to-position behaviour deliberately; it is
  the behaviour under test, not an artefact.
- These are _test-only_ helpers — production code must not import them.

## Examples

```ts
// vertical swipe → a guarded slider keeps its value
simulateNativeSliderGesture(slider, [
  { x: 40, y: 300 },
  { x: 42, y: 240 },
]);

// short tap → a guarded slider commits the value on release
simulateNativeSliderGesture(slider, [{ x: 70, y: 300 }], { durationMs: 90 });
```

## Tests

Exercised by [`../utils/slider-scroll-guard.test.ts`](../utils/slider-scroll-guard.test.ts),
[`../utils/slider-scroll-guard.property.test.ts`](../utils/slider-scroll-guard.property.test.ts)
and the slider-gesture tests in the recorder and demo apps.
