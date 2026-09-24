# Sun Shadow Rig Demo Plan

## Goal

Create a standalone TypeScript and Vite demo for the production Sun Shadow Rig module. The demo demonstrates realistic sun-driven shadow behavior in a Three.js scene, showing how shadows swing round and stretch/shrink exactly as a real sun's would based on time of day and location.

## Production API

The demo must consume the framework through its public workspace package:

```ts
import { calculateSunPosition } from "gps-plus-slam-app-framework/geo";
import { createSunShadowRig } from "gps-plus-slam-app-framework/visualization";
```

All shadow rig logic, light placement, frustum calculation, and shadow map configuration remain in `GpsPlusSlamJs_AppFramework`. The demo only drives the rig with sun position calculations and provides a simple Three.js scene for visualization.

## Scene Setup

The demo contains a minimal Three.js scene with:

- A perspective camera and WebGL renderer
- A ground plane (large flat surface to receive shadows)
- A simple box geometry (cast shadow object) positioned above the ground
- The production sun-shadow-rig component
- A fixed observer latitude and longitude, initially Berlin
- A displayed simulated date and time
- Play/pause, reset, and time-speed controls
- A manual time slider covering at least one full local day
- A status display showing sun altitude, azimuth, NUE direction, and shadow rig state

The box should be positioned at a reasonable height above the ground plane so its shadow is clearly visible and changes length as the sun moves.

## Time Scrubbing and Animation

The demo advances a simulated `Date` to show shadow behavior throughout the day:

- At a modest fixed cadence, call `calculateSunPosition()` for the fixed location
- Pass `result.directionNue` to the shadow rig's `update()` method
- Render the scene to show shadow changes
- Allow pausing and manual scrubbing via a time slider
- The shadow should swing around the box as the sun's azimuth changes
- The shadow should stretch and shrink as the sun's altitude changes
- At night (sun below horizon), shadows should disappear

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
- Light intensity (if using sun-altitude-lighting module)

## Structure

Create an isolated `GpsPlusSlamJs_SunShadowRigDemo` pnpm workspace package with:

- `package.json` for Vite, TypeScript, Three.js, and the framework `workspace:*` dependency
- `tsconfig.json` for strict browser TypeScript (extending `tsconfig.demo-base.json`)
- `vite.config.ts` with a dedicated development-server port (5188)
- `index.html` for the canvas and UI controls
- `src/main.ts` for Three.js scene setup, sun position calculation, and shadow rig integration
- `src/style.css` for basic styling

The package's `dev` and `build` commands will build the framework before Vite, matching the existing demo packages. It can be run directly from its directory with `pnpm run dev` or from the repository root with `pnpm --filter gps-plus-slam-sun-shadow-rig-demo dev`.

Register the package in `pnpm-workspace.yaml` and update `pnpm-lock.yaml`. Update `docs/dev-server-ports.md` to document port 5188. Add root `package.json` scripts for testing if needed.

## Coordinate System

The demo uses the framework's North-Up-East (NUE) coordinate system:

- `+X` = North
- `+Y` = Up  
- `+Z` = East

The shadow rig expects NUE directions from `calculateSunPosition()` and positions the directional light accordingly. The Three.js scene should be set up with the ground plane on the XZ plane (y=0) and the box positioned above it.

## Shadow Behavior Verification

The demo should demonstrate these realistic shadow behaviors:

- Morning: long shadows pointing west
- Noon: short shadows directly beneath objects (for high sun)
- Afternoon: long shadows pointing east
- Sunrise/sunset: very long shadows
- Night: no shadows (sun below horizon)
- Shadow length changes smoothly as sun altitude changes
- Shadow direction changes smoothly as sun azimuth changes

## Out of scope

- SunCalc or NUE calculation code in the demo
- Complex geometry or models beyond a simple box
- WebXR session creation or device orientation
- Live GPS or real-time clock
- Production-site navigation or deployment
- Atmospheric effects, ambient lighting, or other lighting models
- Shadow quality settings beyond the rig's defaults
- Multiple shadow casters or complex shadow scenarios

## Success criteria

- The demo uses `calculateSunPosition()` and `createSunShadowRig()` from the production framework package
- It contains no duplicated SunCalc, NUE conversion, or shadow calculation logic
- A box on a ground plane casts realistic shadows
- Scrubbing time causes shadows to swing round the box (azimuth change)
- Scrubbing time causes shadows to stretch and shrink (altitude change)
- At night, shadows disappear (sun below horizon)
- The demo builds and runs independently
- All shadow behavior matches expected astronomical patterns
- The demo uses port 5188 as documented in dev-server-ports.md

## Exact files planned

Demo files to create:

- `GpsPlusSlamJs_SunShadowRigDemo/package.json`
- `GpsPlusSlamJs_SunShadowRigDemo/tsconfig.json`
- `GpsPlusSlamJs_SunShadowRigDemo/vite.config.ts`
- `GpsPlusSlamJs_SunShadowRigDemo/index.html`
- `GpsPlusSlamJs_SunShadowRigDemo/src/main.ts`
- `GpsPlusSlamJs_SunShadowRigDemo/src/style.css`
- `GpsPlusSlamJs_SunShadowRigDemo/PLAN.md` (this file)

Workspace files to modify when the demo is implemented:

- `pnpm-workspace.yaml` (add the new demo package)
- `docs/dev-server-ports.md` (document port 5188)
- Root `package.json` (add test script if needed)

This `PLAN.md` is the only file created during planning approval. None of the other listed files are to be created or modified until implementation is separately approved.
