# `look-choice.ts`

## Purpose

The demo's look choice: a colour scheme, or `"timeofday"`, the blend of the
four sun looks. Three-free, so the worker and the page share it.

## Public API

- `TIME_OF_DAY` (`"timeofday"`), `LookChoice` (`ColourSchemeName | "timeofday"`),
  `TIME_OF_DAY_LOOKS` (`today`, `golden`, `dusk`, `bluehour`, in that order),
  `LOOK_CHOICES` (the dropdown's values), `lookLabel`,
  `isLookChoice` (own keys only; `"toString"` is not a choice).
- `resolveLook(chosen, {ar})` - what is BUILT: AR always builds the default
  scheme, otherwise the choice. Only the request side (`main.ts`'s refresh)
  reads it; the switch's `meshDrawn` does not. AR plus the blend still
  settles: the worker compares build keys, so the same default build is not
  rebuilt, and the switch's `setArActive` clears what it was waiting for.
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
- The sun derives the weights (`look-driver.ts`, `selectLookWeights` in
  `osm-store.ts`); the light mixes by the same weights (`look-light.ts`,
  whose veil mix is `blendVeils`).

## Examples

```ts
const pinned = parseLookWeights(params.get("lookWeights")) ?? null;
const built = resolveLook(selectColourScheme(state), { ar: inAr });
```

## Tests

`look-choice.test.ts`: link round-trip, store, `lookBuildOf`, "AR plus
timeofday settles, no rebuild loop", and a `parseLookWeights` property plus the
invalid inputs.
