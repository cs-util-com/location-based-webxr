# content-fade.ts

## Purpose

Fading a three.js subtree in and out: a station's content when the visitor
enters or leaves its radius (`station-content.ts`), and a story's figure
with its station (`scene-stage.ts`). Visitor plan 2026-10-18-2349 §3.

## Public API

- `CONTENT_FADE_MS = 400` - the fade's length (ms), in and out alike.
- `setSubtreeOpacity(root, alpha)` - every material under `root` at
  `alpha` (clamped to 0..1; a non-finite alpha reads as 1) times the
  material's OWN opacity.
- `stepAlpha(alpha, target, elapsedMs, fadeMs)` - `alpha` moved towards
  `target` at the rate that crosses the whole range in `fadeMs`; a
  non-positive `fadeMs` jumps to the target; a negative or non-finite
  elapsed time moves nothing.

## Invariants & assumptions

- The material's own opacity and `transparent` flag are remembered (a
  `WeakMap`) the first time it is touched, so a label drawn at 0.9 stays
  0.9 at full alpha, and an opaque photo plane is opaque again at 1: an
  opaque plane left in the transparent pass would stop occluding for good.
  `needsUpdate` is set only when `transparent` changes.
- A fade reversed half way takes half the time back (constant rate, not a
  fixed-length tween).
- The parameter and its sweep (200-1000 ms, at 30 frames a second,
  `station-content.sweep.test.ts`):
  - a switch (out, then in) takes two fades, so a switch under 1 s needs
    less than 500 ms;
  - a step per frame of at most 10 % (a fade rather than a pop) needs at
    least 334 ms;
  - 400 ms sits inside that window and carries a leaving station's content
    about 0.6 m past its exit at a 1.4 m/s walk;
  - reversed by a phone where 400 ms reads as a pop (600 ms gives a 1.2 s
    switch) or a museum where 0.8 s per switch reads as slow (250 ms gives
    13 % steps at 30 fps).

## Example

```ts
let alpha = 0;
alpha = stepAlpha(alpha, 1, frameMs, CONTENT_FADE_MS);
setSubtreeOpacity(group, alpha);
```

## Tests

- Through its callers: `station-content.test.ts` (the fade in, the opaque
  flag restored at the end, the fade out), `scene-stage.test.ts` (the
  figure at half opacity half way), `station-content.sweep.test.ts` (the
  length's sweep).
