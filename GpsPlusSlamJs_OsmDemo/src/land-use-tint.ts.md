# `land-use-tint.ts`

## Purpose

Controls the land-use tint (city objects plan 2026-11-07-2315 M3) on the
demo's lit ground material: which build's tint is applied, whether it shows,
and what colour the material carries without one. `building-view.ts` owns
one instance.

## Public API

- `landUseTint(material, {wanted?, appearance?, anisotropy?}) -> LandUseTint`
  - `setTint(tint | undefined)` - the latest full build's `GroundTint`;
    replaces and frees the previous one, a no-op for the same object.
  - `setWanted(on)` - the "land-use colours" layer switch (`tint`).
  - `setAppearance(plain | slope | ramp)` - the ramp hides the tint.
  - `setGroundColour(0xrrggbb)` - the scheme's ground; `RangeError` otherwise.
  - `showing()` - whether the tint is drawn now.
  - `dispose()` - frees the tint, leaves the ground colour.

## Invariants & assumptions

- Drawn exactly when a tint is applied AND wanted AND the appearance is not
  `ramp` (owner Q6: on in the plain and slope grounds, off in the ramp ones).
- The material is white exactly while a tint is applied (the patch multiplies
  by the tint's neutral, so a ground colour there would square it); otherwise
  it carries the last `setGroundColour`. Off under a tint (`groundOn` 0) is
  the neutral everywhere, which is the plain ground: the old e2e luma and
  chroma gates measure today's ground with the switch off.
- Hiding is a uniform write, no rebuild; a new tint per full build reuses the
  cached program (same cache key).

## Examples

```ts
const control = landUseTint(groundMaterial, { anisotropy: 8 });
control.setTint(mesh.groundTint); // per full build
control.setWanted(layers.tint); // the switch
control.setAppearance("ramp"); // hidden
```

## Tests

- `land-use-tint.test.ts` - default on with a white material, the switch and
  the ramp, the first build with the switch off, replacement frees the old
  texture and patches once, the same tint is a no-op, the ground colour in
  both states, bad colours, dispose.
- `land-use-tint.property.test.ts` - any sequence of the four inputs keeps
  both invariants above.
