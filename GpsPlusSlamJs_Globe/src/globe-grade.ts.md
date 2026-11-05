# globe-grade.ts - the globe's colour grade as named presets

## Purpose

One table of tone curve plus exposure, so the globe's look is a named
choice rather than a value fixed inside `globe-view.ts`. Pages pick a name
by link (`?grade=<name>`); the default keeps the look unchanged until a
look is chosen.

## Public API

- `GLOBE_GRADES`: frozen table, name to `{ toneMapping, exposure }`.
- `GlobeGradeName`: the table's keys.
- `DEFAULT_GLOBE_GRADE`: `"neutral"`.
- `GLOBE_GRADE_PARAM`: `"grade"`, the link's parameter.
- `resolveGlobeGrade(name, warn = console.warn)`: the name to use. `null`
  (nothing in the link) is the default, silently; an unknown name is the
  default with one warning naming the known ones. Never throws.
- `applyGlobeGrade(renderer, name)`: sets `toneMapping` and
  `toneMappingExposure`. `RangeError` for a name not in the table: a caller
  passing an unjudged string is a bug, not a typed link.

`globe-view.ts` calls `applyGlobeGrade` once at creation (option `grade`).
The lazy view entry re-exports `resolveGlobeGrade`, so an app's first-load
code can hold the raw name without loading the globe.

## The presets

Chosen by looking at the real globe at street level, 300 m, 3 km and 60 km.

- `neutral`: Neutral at 1. Today's look, bright and saturated, the
  default.
- `aces`: ACES at 0.47, the exposure of the look prototype's page. On the
  real globe it is the darkest: clouds turn grey at 60 km and near ground
  goes dark.
- `aces-bright`: ACES at 0.75. Keeps the filmic shoulder and contrast
  while whites stay white: the step between `neutral` and `aces`.
- `agx`: AgX at 1. The other direction: flat, soft and desaturated, with
  the most detail left in cloud tops and shadows.

What the choices rest on (swept: ACES 0.47, 0.6, 0.75, 1; AgX 1, 1.4;
Neutral 0.8):

- ACES 0.75 over 0.6: 0.6 reads as `aces` again. ACES 1 would take the slot
  if clouds must be as white as `neutral`'s: it matches that brightness
  with darker shadows, but then no step lies between the two.
- AgX 1 over 1.4: 1.4 washes out the ground at 60 km. If only the near
  ground counted, 1.4 would win, because AgX 1 is dull there.
- Neutral 0.8 was dropped: it is the same picture, darker, not a look.

## Invariants and assumptions

- **A grade is fixed for a view's life.** three compiles the tone curve
  into every program (its cache key holds `toneMapping`), so a switch would
  recompile all materials; a link is read once at start.
- **Tone mapping happens only where a pass draws to the screen.** The ground
  sky and the cloud volumes render untoned into targets and are toned in
  their composites, so those follow the grade.
- **Honour the grade:** surface, relief, city, space air
  (`globe-atmosphere.ts`), ground sky composite, cloud volume composites,
  and the 3D interface (`globe-interface-pass.ts`: pins and rings shift
  with the grade like every lit object; an exact brand colour there would
  need `toneMapped = false`, which changes the default look).
- **Ignore the grade by design:** `globe-sky.ts` (sun disc, stars, Milky
  Way, navy space: display colours, a curve would crush the faint band) and
  `globe-speed-dust-pass.ts` (additive display colour). DOM chips and
  controls are not part of the picture.
- **three's `aces` is not the prototype's curve.** The prototype applies the
  Narkowicz fit and a plain gamma; three applies the Hill fit with its
  matrices and divides the exposure by 0.6. At the same 0.47 three's is
  darker in the shadows (8-bit grey at 0.18 scene value: 76 against 89).
  The scene's radiance scale differs as well, so a preset cannot reproduce
  the prototype's picture by the number alone.

## Example

```ts
const grade = resolveGlobeGrade(params.get(GLOBE_GRADE_PARAM));
createGlobeView({ canvas, grade });
```

## Tests

- `globe-grade.test.ts`: the table, the resolver, the apply.
- `globe-view.test.ts` ("the grade"): the view sets the preset.
- `GpsPlusSlamJs_TourViewer/playwright-tests/editor3d-globe-default.spec.js`:
  the link reaches the renderer of the real page.
