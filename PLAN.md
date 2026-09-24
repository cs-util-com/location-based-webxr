# Sun-Driven Lighting: Iteration 1

## Goal

Calculate the real sun direction from latitude, longitude, and a TypeScript
`Date`, expressed as a normalized vector in the framework's NUE coordinate
system. Iteration 1 covers calculation and tests only; it does not change the
Three.js scene or lighting.

## Coordinate conventions

The framework uses NUE coordinates:

- `+X` = North, `-X` = South
- `+Y` = Up
- `+Z` = East, `-Z` = West

`SunCalc.getPosition(date, latitude, longitude)` returns:

- `altitude`: angle above the horizon
- `azimuth`: measured from **South**, positive toward **West** and negative
  toward East

SunCalc azimuth is therefore not clockwise from North. This distinction is a
critical source of sign and axis bugs.

For SunCalc azimuth `a` and altitude `h`, the direction from the scene toward
the sun in NUE is:

```text
x = -cos(h) * cos(a)
y =  sin(h)
z = -cos(h) * sin(a)
```

Sanity checks:

| SunCalc angles | Direction | Expected NUE vector |
| --- | --- | --- |
| `a = 0`, `h = 0` | South | `(-1, 0, 0)` |
| `a = +pi/2`, `h = 0` | West | `(0, 0, -1)` |
| `a = -pi/2`, `h = 0` | East | `(0, 0, +1)` |
| `a = pi`, `h = 0` | North | `(+1, 0, 0)` |
| any `a`, `h = +pi/2` | Zenith | `(0, +1, 0)` |

Floating-point comparisons must use tolerances rather than exact equality.

## Approach

Use SunCalc for the astronomical calculation instead of implementing solar
equations locally. SunCalc is the simpler and safer choice for a student
project: it avoids maintaining date, orbital, declination, and hour-angle math,
while leaving the project-specific NUE conversion explicit and testable.

Before implementation, confirm SunCalc's package license and which workspace
package owns the feature:

- Prefer `GpsPlusSlamJs_AppFramework` if live AR, replay, or multiple apps need
  it.
- Keep it in a specific app only if the feature belongs exclusively to that
  app.

Implement the feature in TypeScript (`.ts`), following the owning package's
existing `tsconfig` and strictness rules. Do not add a separate JavaScript
implementation or maintain duplicate `.js` source files; the package build
will generate JavaScript and declaration files from the TypeScript source.

Do not copy the OSM demo's current sun vector directly. Its simulated day is not
GPS/date based, and its render axes (`+X` East, `+Y` Up, `-Z` North) differ from
NUE.

## Scope

Iteration 1 will:

1. Add SunCalc to the package that owns the feature.
2. Add a small, pure TypeScript calculation module and export its public types.
3. Accept a `Date`, latitude in degrees, and longitude in degrees.
4. Call `SunCalc.getPosition()` and convert its angles to NUE.
5. Return the azimuth, altitude, normalized NUE direction, and
   `isAboveHorizon`.
6. Add deterministic unit tests and document the conversion next to the code.

A conceptual result is:

```text
{
  azimuthRad,
  altitudeRad,
  directionNue: { x, y, z },
  isAboveHorizon
}
```

Returning both angles and the vector makes coordinate errors easier to debug.

## TypeScript and typings specification

Keep the types structural and small. Coordinates and angles remain `number`
values; their units are made explicit in property and parameter names rather
than through casts or branded-number types.

The calculation module should expose these read-only public shapes:

```ts
export interface NueDirection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SunPositionResult {
  readonly azimuthRad: number;
  readonly altitudeRad: number;
  readonly directionNue: NueDirection;
  readonly isAboveHorizon: boolean;
}
```

The pure conversion and public calculation signatures should be:

```ts
export function sunCalcAnglesToNue(
  azimuthRad: number,
  altitudeRad: number,
): NueDirection;

export function calculateSunPosition(
  date: Date,
  latitudeDeg: number,
  longitudeDeg: number,
): SunPositionResult;
```

Use `import SunCalc from "suncalc"` only if that form passes the owning
package's TypeScript configuration. Otherwise use the import form supported by
SunCalc's declarations and the existing module settings; do not silence an
import problem with `any`, `@ts-ignore`, or an unsafe cast.

At dependency-selection time, inspect the installed SunCalc version for bundled
TypeScript declarations. If it does not provide them, add the matching
`@types/suncalc` package as a `devDependency` of the owning workspace package.
Do not write a local ambient `declare module "suncalc"` file unless neither the
library nor DefinitelyTyped supplies compatible declarations; if a local
declaration becomes necessary, keep it minimal and type only the used API:
`getPosition(date: Date, latitude: number, longitude: number)` returning finite
numeric `azimuth` and `altitude` properties.

The module and its types must be exported through the owning package's existing
public TypeScript entry point. Its build must emit corresponding `.d.ts` files,
so consumers receive the same API types as the source. Tests should also be
written in TypeScript (`.test.ts`) and must pass both the production and test
typecheck commands.

## Input and edge-case policy

- Reject an invalid `Date`.
- Reject non-finite latitude or longitude.
- Reject latitude outside `[-90, 90]` and longitude outside `[-180, 180]`;
  do not silently clamp them.
- Use the normal geographic longitude convention: positive East, negative
  West.
- Treat `Date` as an absolute instant; the same timestamp must produce the same
  result regardless of display timezone.
- Preserve negative altitude and set `isAboveHorizon` to `altitude > 0`.
- Keep returning the astronomical direction below the horizon. Rendering policy
  must not be hidden inside the calculation.
- Handle azimuth wrapping (`-pi`/`+pi`) through the trigonometric conversion.
- Near the zenith, accept that azimuth has little practical meaning while the
  direction remains valid.
- Treat TypeScript types as compile-time guidance, not runtime validation.
  Retain all validation above because JavaScript callers and untrusted runtime
  values can still reach the compiled API.

## Tests

Test the angle-to-NUE conversion independently from the SunCalc adapter.
Write tests as `.test.ts` files without using `any` to bypass the public API.

### Conversion tests

- South, West, East, and North map to the expected NUE axes.
- Zenith maps to Up.
- Negative altitude produces negative `Y`.
- The vector length is approximately `1` across representative angles.
- Equivalent wrapped azimuths produce equivalent directions.

### SunCalc adapter tests

- Date, latitude, and longitude are passed in the correct order.
- SunCalc angles are preserved in the result.
- The result uses the separately tested NUE conversion.
- Fixed daytime and nighttime cases set `isAboveHorizon` correctly.
- Invalid inputs follow the documented policy.

Avoid overly precise hand-calculated astronomical assertions. If real reference
positions are used, document their source and use a reasonable angular
tolerance.

## Out of scope

- Modifying or aiming the existing `DirectionalLight`
- Reading live GPS state or adding timers
- Updating anything every animation frame
- Enabling shadow maps, shadow casters, or receivers
- Sky shaders, environment maps, weather, clouds, light color, or intensity
- UI controls and sunrise/sunset transitions

## Success criteria

Iteration 1 is complete when:

- Fixed latitude, longitude, and `Date` inputs produce deterministic angles and
  a NUE direction.
- The four cardinal tests pass; swapping East/West or North/South makes tests
  fail.
- Negative altitude produces a direction below the NUE horizon.
- The returned direction has length approximately `1`.
- Day/night status and invalid-input behavior are documented and tested.
- The critical SunCalc azimuth convention is documented beside the conversion.
- The source and tests pass the owning package's TypeScript checks without
  `any`, `@ts-ignore`, or handwritten casts that hide SunCalc type errors.
- The package build emits usable declarations for `NueDirection`,
  `SunPositionResult`, `sunCalcAnglesToNue`, and `calculateSunPosition`.
- No Three.js scene, light, renderer, GPS subscription, or shadow behavior has
  changed.

## Follow-up iteration

Iteration 2 can read the latest valid GPS fix, use the current or replayed time,
and update the framework's root-level `DirectionalLight` in GPS-world NUE space.
It should define nighttime behavior and update only on meaningful input changes
or a slow timer. Shadow rendering remains a separate later iteration.
