# Sun Altitude Lighting Demo Plan

## Goal

Create a standalone TypeScript and Vite demo for the production Sun Altitude Lighting module. The demo demonstrates realistic lighting changes throughout a full day cycle, showing how the scene's colour and brightness shift believably as the user scrubs from dawn → noon → dusk → night.

## Production API

The demo must consume the framework through its public workspace package:

```ts
import { calculateSunPosition } from "gps-plus-slam-app-framework/geo";
import { sunAltitudeToLighting } from "gps-plus-slam-app-framework/geo";
import { createSunShadowRig } from "gps-plus-slam-app-framework/visualization";
```

All astronomical calculations, altitude-to-lighting conversion, and shadow rig logic remain in `GpsPlusSlamJs_AppFramework`. The demo only drives the lighting and shadow rig with sun position calculations and provides a simple Three.js scene for visualization.

## Scene Setup

The demo contains a minimal Three.js scene based on the shadow-rig demo:

- A perspective camera and WebGL renderer
- A ground plane (large flat surface to receive shadows)
- A simple box geometry (cast shadow object) positioned above the ground
- The production sun-shadow-rig component
- The production sun-altitude-lighting module
- A fixed observer latitude and longitude, initially Berlin
- A displayed simulated date and time
- Play/pause, reset, and time-speed controls
- A manual time slider covering at least one full local day
- A status display showing sun altitude, azimuth, NUE direction, shadow rig state, and lighting values

The box should be positioned at a reasonable height above the ground plane so its shadow is clearly visible and changes length as the sun moves.

## Lighting Integration

The demo applies the sun-altitude-lighting module's output to the scene's lighting:

1. Calculate sun position using `calculateSunPosition()`
2. Extract `altitudeRad` from the result
3. Pass `altitudeRad` to `sunAltitudeToLighting()` to get lighting values
4. Apply the lighting values to the scene:
   - Set directional light intensity from `result.intensity`
   - Set directional light color from `result.color`
   - Set ambient light intensity from `result.ambientLevel`
5. Pass `directionNue` to the shadow rig's `update()` method for shadow behavior

The scene background color should also be updated to match the lighting color for atmospheric realism.

## Time Scrubbing and Animation

The demo advances a simulated `Date` to show lighting behavior throughout the day:

- At a modest fixed cadence, call `calculateSunPosition()` for the fixed location
- Pass `altitudeRad` to `sunAltitudeToLighting()` to get lighting values
- Apply lighting values to the scene lights
- Pass `directionNue` to the shadow rig's `update()` method
- Render the scene to show lighting and shadow changes
- Allow pausing and manual scrubbing via a time slider
- The lighting should transition smoothly through phases:
  - Night: deep blue-violet, very dark, no direct light
  - Astronomical twilight: blue-violet fading, ambient rising
  - Civil twilight/dawn: orange-red, direct light appearing
  - Golden hour: warm amber/orange, soft shadows
  - Daytime: warm white to pure white, full intensity
- Shadows should appear and disappear with the sun
- The scene background should reflect the current lighting color

## Input Controls

Provide editable controls for:

- Latitude in degrees (default: Berlin `52.52`)
- Longitude in degrees (default: Berlin `13.405`)
- Date and time as an ISO 8601 string (default: `2026-06-21T12:00:00Z`)
- Time scrub slider covering a full day
- Play/pause button
- Time speed control
- Reset button

## Output Display

Display the following information:

- Current simulated date/time
- Sun altitude (degrees)
- Sun azimuth (degrees)
- NUE direction (x, y, z components)
- Whether sun is above horizon
- Shadow rig visibility state
- **Lighting values:**
  - Direct light intensity
  - Direct light color (hex value)
  - Ambient light level
  - Current lighting phase (if possible to infer from altitude)

## Structure

Create an isolated `GpsPlusSlamJs_SunAltitudeLightingDemo` pnpm workspace package with:

- `package.json` for Vite, TypeScript, Three.js, and the framework `workspace:*` dependency
- `tsconfig.json` for strict browser TypeScript (extending `tsconfig.demo-base.json`)
- `vite.config.ts` with a dedicated development-server port (5189)
- `index.html` for the canvas and UI controls
- `src/main.ts` for Three.js scene setup, sun position calculation, lighting integration, and shadow rig integration
- `src/style.css` for basic styling

The package's `dev` and `build` commands will build the framework before Vite, matching the existing demo packages. It can be run directly from its directory with `pnpm run dev` or from the repository root with `pnpm --filter gps-plus-slam-sun-altitude-lighting-demo dev`.

Register the package in `pnpm-workspace.yaml` and update `pnpm-lock.yaml`. Update `docs/dev-server-ports.md` to document port 5189. Add root `package.json` scripts for testing if needed.

## Coordinate System

The demo uses the framework's North-Up-East (NUE) coordinate system:

- `+X` = North
- `+Y` = Up  
- `+Z` = East

The shadow rig expects NUE directions from `calculateSunPosition()` and positions the directional light accordingly. The Three.js scene should be set up with the ground plane on the XZ plane (y=0) and the box positioned above it.

## Lighting Behavior Verification

The demo should demonstrate these realistic lighting behaviors:

- **Night phase** (altitude < -18°): 
  - Scene is very dark with deep blue-violet tint
  - No direct light intensity
  - Very low ambient level (~0.02)
  - No shadows visible
- **Astronomical twilight** (-18° to -6°):
  - Scene transitions from deep navy to blue-violet
  - Still no direct light
  - Ambient level rises from 0.02 to 0.15
  - No shadows visible
- **Civil twilight/dawn** (-6° to 0°):
  - Scene becomes orange-red near horizon
  - Direct light intensity ramps from 0 to 0.15
  - Ambient level rises from 0.15 to 0.35
  - Shadows begin to appear as direct light emerges
- **Golden hour** (0° to 6°):
  - Scene has warm amber/orange glow
  - Direct light intensity ramps from 0.15 to 0.55
  - Ambient level rises from 0.35 to 0.65
  - Shadows are soft and warm-colored
- **Daytime** (> 6°):
  - Scene transitions from warm white to pure white
  - Direct light intensity ramps to 1.0
  - Ambient level ramps to 1.0
  - Shadows are sharp and realistic
- All transitions should be smooth without visible jumps
- The scene background should reflect the current lighting color

## Out of scope

- SunCalc or NUE calculation code in the demo
- Complex geometry or models beyond a simple box
- WebXR session creation or device orientation
- Live GPS or real-time clock
- Production-site navigation or deployment
- Atmospheric effects beyond basic background color
- Shadow quality settings beyond the rig's defaults
- Multiple shadow casters or complex shadow scenarios
- Custom lighting models or sky shaders
- Light temperature or environmental lighting
- Fog or other environmental effects

## Success criteria

- The demo uses `calculateSunPosition()`, `sunAltitudeToLighting()`, and `createSunShadowRig()` from the production framework package
- It contains no duplicated SunCalc, NUE conversion, lighting calculation, or shadow calculation logic
- A box on a ground plane casts realistic shadows
- Scrubbing time causes shadows to swing round the box (azimuth change)
- Scrubbing time causes shadows to stretch and shrink (altitude change)
- At night, shadows disappear (sun below horizon)
- **The scene lighting transitions believably through all phases:**
  - Night: dark, blue-violet, no direct light
  - Twilight: colors and ambient levels change smoothly
  - Dawn: orange-red, direct light appears
  - Golden hour: warm amber, soft shadows
  - Daytime: white, full intensity, sharp shadows
- The scene background color matches the lighting color
- All lighting values are displayed in the status panel
- The demo builds and runs independently
- All lighting behavior matches the sun-altitude-lighting module specification
- The demo uses port 5189 as documented in dev-server-ports.md

## Exact files planned

Demo files to create:

- `GpsPlusSlamJs_SunAltitudeLightingDemo/package.json`
- `GpsPlusSlamJs_SunAltitudeLightingDemo/tsconfig.json`
- `GpsPlusSlamJs_SunAltitudeLightingDemo/vite.config.ts`
- `GpsPlusSlamJs_SunAltitudeLightingDemo/index.html`
- `GpsPlusSlamJs_SunAltitudeLightingDemo/src/main.ts`
- `GpsPlusSlamJs_SunAltitudeLightingDemo/src/style.css`
- `GpsPlusSlamJs_SunAltitudeLightingDemo/PLAN.md` (this file)

Production file to modify:

- `GpsPlusSlamJs_AppFramework/src/geo/index.ts` (add sun-altitude-lighting exports)

Workspace files to modify when the demo is implemented:

- `pnpm-workspace.yaml` (add the new demo package)
- `docs/dev-server-ports.md` (document port 5189)
- Root `package.json` (add test script if needed)

This `PLAN.md` is the only file created during planning approval. None of the other listed files are to be created or modified until implementation is separately approved.
