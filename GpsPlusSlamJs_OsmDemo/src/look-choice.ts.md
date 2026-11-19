# `look-choice.ts`

## Purpose

The demo's look choice: a colour scheme, or `"timeofday"`, the blend of the
four sun looks. Three-free, so the worker and the page share it.

## Public API

- `TIME_OF_DAY` (`"timeofday"`), `LookChoice` (`ColourSchemeName | "timeofday"`),
  `TIME_OF_DAY_LOOKS` (`today`, `golden`, `dusk`, `bluehour`, in that order),
  `LOOK_CHOICES` (the dropdown's values), `lookLabel`,
  `isLookChoice` (own keys only; `"toString"` is not a choice).
- `DAY_LOOK_WEIGHTS` - `[1, 0, 0, 0]`: the blend's look weights until something
  sets them.
- `resolveLook(chosen, {ar})` - what is BUILT: AR always builds the default
  scheme, otherwise the choice. The request side (`main.ts`'s refresh) and the
  echo side (the switch's `meshDrawn`) use this one rule, so AR plus the blend
  settles instead of asking for a rebuild after every build.
- `resolveLookChoice(value, warn)` / `lookLinkValue(choice)` - the `?scheme=`
  link value in and out; an unknown value warns once and gives the default.
- `parseLookWeights(value, warn)` - the `?lookWeights=a,b,c,d` hook: four
  finite non-negative numbers with a positive sum, normalised and frozen;
  anything else is ignored with one warning (`undefined`).
- `lookBuildOf(choice)` - the worker's build options: `{colours}` for a scheme,
  `{colours: looks[0], looks}` for the blend (the library requires look 0 to be
  the colours).

## Invariants & assumptions

- Look weights are normalised (sum 1) and drive the CPU rules (ground, trees,
  veil); the shader's trim weights are look weights times each look's
  brightness trim (`mixed-page-look.ts`). The two are never interchangeable.

## Examples

```ts
const weights = parseLookWeights(params.get("lookWeights")) ?? DAY_LOOK_WEIGHTS;
const built = resolveLook(selectColourScheme(state), { ar: inAr });
```

## Tests

`look-choice.test.ts`: link round-trip, store, `lookBuildOf`, "AR plus
timeofday settles, no rebuild loop", and a `parseLookWeights` property plus the
invalid inputs.
