# clamp.ts

## Purpose

Clamp a value into the inclusive `[0, 1]` range.

## Public API

- **`clamp01(value: number): number`** — returns `0` below the range, `1`
  above it, and `value` unchanged inside it.

## Invariants & assumptions

- Pure. No dependencies.

## Examples

```ts
import { clamp01 } from 'gps-plus-slam-app-framework/visualization';

clamp01(-0.4); // 0
clamp01(1.7); // 1
clamp01(0.3); // 0.3
```

## Tests

- Exercised transitively via `playback-transport.test.ts` (the `seek` action)
  and `panel-layout.test.ts` (the track seek-fraction mapping); it has no
  dedicated test file of its own.
