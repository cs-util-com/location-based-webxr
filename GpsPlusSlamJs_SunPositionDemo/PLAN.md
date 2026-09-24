# Sun Position Demo Plan

## Goal

Create a small, standalone TypeScript and Vite demo for the production Sun
Position Core. The demo explains the calculation's inputs and outputs without
starting WebXR, Three.js, GPS subscriptions, scene lighting, or animation.

## Production API

The demo must consume the framework through its public workspace package:

```ts
import { calculateSunPosition } from "gps-plus-slam-app-framework/geo";
```

All astronomical calculations, input validation, and SunCalc-to-NUE conversion
remain in `GpsPlusSlamJs_AppFramework`. The demo may calculate
`Math.hypot(x, y, z)` only to display the returned direction's length; it must
not call SunCalc or repeat the NUE conversion formulas.

## Inputs

Provide three editable controls:

- Latitude in degrees
- Longitude in degrees
- Date and time as an ISO 8601 string representing an absolute instant

Start with the fixed Berlin daytime example:

- Latitude: `52.52`
- Longitude: `13.405`
- Date: `2026-06-21T12:00:00Z`

Also document the fixed Berlin nighttime example
`2026-06-21T00:00:00Z` so it is easy to paste into the same date field.

## Output

After the user selects **Calculate**, display:

- `azimuthRad`
- `altitudeRad`
- `directionNue.x`
- `directionNue.y`
- `directionNue.z`
- NUE vector length
- `isAboveHorizon`

If the production function rejects an input, show a readable validation error
on the page and do not display stale results.

## Structure

Create an isolated `GpsPlusSlamJs_SunPositionDemo` pnpm workspace package with:

- `package.json` for Vite, TypeScript, and the framework `workspace:*`
  dependency
- `tsconfig.json` for strict browser TypeScript
- `vite.config.ts` with a dedicated development-server port
- `index.html` for the small form and result display
- `src/main.ts` for DOM wiring and the production API call

The package's `dev` and `build` commands will build the framework before Vite,
matching the existing demo packages. It can be run directly from its directory
with `pnpm run dev` or from the repository root with
`pnpm --filter gps-plus-slam-sun-position-demo dev`.

Register the package in `pnpm-workspace.yaml` and update `pnpm-lock.yaml`. A new
root `package.json` script is unnecessary because existing demos are normally
run through their own scripts or pnpm's `--filter` option. Do not add the demo
to the combined production site build in this iteration.

## Out of scope

- SunCalc or NUE calculation code in the demo
- Three.js rendering or a visual sun arrow
- WebXR and live GPS access
- `DirectionalLight` or other scene changes
- Timers or automatic updates
- Production-site navigation or deployment

## Success criteria

- The demo uses `calculateSunPosition()` from the production framework package.
- It contains no duplicated SunCalc or NUE conversion logic.
- Latitude, longitude and date/time can be changed.
- It displays azimuth, altitude, NUE x/y/z, vector length and
  `isAboveHorizon`.
- The fixed Berlin daytime example is above the horizon.
- The fixed Berlin nighttime example is below the horizon.
- The displayed NUE vector length is approximately `1`.
- Invalid coordinates or date/time display a validation error.
- The demo builds and runs independently.
