# tap-gate.ts

## Purpose

Pure tap-vs-drag predicate: decides whether a pointer down→up pair is a
_tap_ (a select) rather than an `OrbitControls` camera-drag or a long-press.
`pointer-tap-picker.ts` owns the DOM listeners and multi-touch bookkeeping
and asks this predicate the one question that matters.

## Public API

- **`PointerSample`** — `{ x, y, timeMs }`, one pointer event reduced to what
  the gate needs.
- **`isTap(down: PointerSample, up: PointerSample): boolean`** — `true` when
  the pointer moved ≤ 5 px and was released within 400 ms of `down`.

## Invariants & assumptions

- Pure. No dependencies. Thresholds (`5px` / `400ms`) are fixed constants,
  pinned by tests.

## Examples

```ts
import { isTap } from 'gps-plus-slam-app-framework/visualization';

isTap({ x: 0, y: 0, timeMs: 0 }, { x: 2, y: 1, timeMs: 120 }); // true
isTap({ x: 0, y: 0, timeMs: 0 }, { x: 40, y: 0, timeMs: 120 }); // false — drag
```

## Tests

- `tap-gate.test.ts` — within/at/beyond the distance threshold, within/at/
  beyond the time threshold.
