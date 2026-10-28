# landing/fake-code.ts

## Purpose

The landing's drawn code and its seeded generator: one printed-looking
code (21 x 21 modules, three finder squares) that encodes nothing, drawn
the same by the film's poster (`film-dom.ts`) and the cards' pictures
(`landing-cards-drawing.ts`, which also draws its textures from the
generator).

## Public API

- `seededRandom(seed: number): () => number` - a xorshift generator in
  [0, 1); the same seed gives the same sequence. A zero seed (which would
  stay zero) is replaced by a fixed non-zero one.
- `FAKE_CODE_SIZE` - 21, the modules on a side.
- `fakeCodePath(seed?: number): string` - the code as one SVG path in a
  21 x 21 box: unit squares (`Mx yh1v1h-1z`) where the generator draws
  below 0.47, outside the three 8 x 8 finder corners, then each finder as
  three nested squares (7, 5 and 3 modules, the middle one drawn the other
  way round so `fill-rule="evenodd"` leaves its ring). The default seed is
  the one both pictures use.

## Invariants & assumptions

- Pure and deterministic: no DOM, no global state; the same seed returns
  the same string.
- Not a readable code, on purpose: the landing shows what a code looks
  like, never one a phone could open.

## Examples

```ts
path.setAttribute("d", fakeCodePath());
const r = seededRandom(42);
r(); // in [0, 1)
```

## Tests

- `fake-code.test.ts` - the same pattern per seed, every module inside
  the box and outside the finder corners, the three finders, and a
  property that the generator stays in [0, 1) and repeats per seed; a zero
  seed does not stall.
