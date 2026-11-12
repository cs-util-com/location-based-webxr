# `kinds/audio/warm-glow.ts` - the sounds' warm palette

## Purpose

One palette for every mark a sound draws in the world: an ambient zone's ground glow and its editor range ring (`zone.ts`), and a narration circle's rim, centre glow and plume (`narration-look.ts`). One place, so the marks stay one family and a colour change is one edit.

## Public API

- `WARM_GLOW` - frozen `{ glow, rim, spark, ink }`, each an `Rgb` (`readonly [r, g, b]`, linear 0..1, as a shader's `vec3`):
  - `glow` - the zone's glow, the plume's motes and the circle's centre;
  - `rim` - the zone's range ring and the circle's rim;
  - `spark` - the hot centre of a mote;
  - `ink` - the dark edge that keeps a rim legible on a bright ground.
- `Rgb` - the triple's type.

## Invariants & assumptions

- Warm only: the sounds keep the editor's warm glow; no cool hue joins this palette.
- Values are shader inputs, not CSS: no colour-space conversion is applied (the materials draw them as given).

## Examples

```ts
uniforms.uColor = { value: new Vector3(...WARM_GLOW.glow) };
```

## Tests

`narration-look.test.ts` checks the plume and the rim read their colours from here; `zone.test.ts` covers the zone's glow.
