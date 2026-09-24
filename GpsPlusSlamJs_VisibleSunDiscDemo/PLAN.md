# Visible Sun Disc / Icon

## Goal

Render a small virtual sun disc in the direction supplied by the completed Sun
Position Core. The component accepts a normalized direction in the framework's
North-Up-East (NUE) coordinate system and presents the sun at that direction in
a Three.js scene.

This iteration also provides an isolated desktop demo that advances time and
visually demonstrates the sun arcing across the sky, setting below the horizon,
remaining hidden/parked during the night, and becoming visible again after
sunrise.

The component is a presentation layer only. It does not calculate an
astronomical position, obtain real-world input, control scene lighting, or
produce shadows.

## Coordinate and ownership conventions

The input uses the framework's normalized NUE convention:

- `+X` = North
- `+Y` = Up
- `+Z` = East

The direction points from the observer toward the sun. The Sun Position Core
already owns the SunCalc-to-NUE conversion and exposes the shared
`NueDirection` type. This component must import that type rather than duplicate
the coordinate conversion or introduce another direction type.

The sun disc belongs in GPS-world NUE space. The caller must attach it to the
scene root, or to another parent whose local coordinates are known to be
GPS-world NUE. It must not be attached beneath `arWorldGroup`, because that
group's local coordinates are the AR-odometry side of the alignment transform.

## Architecture

Production code belongs in
`GpsPlusSlamJs_AppFramework/src/visualization/` and is split into two small
modules:

1. `sun-disc-placement.ts` contains engine-light placement and horizon-policy
   logic that can be tested without a renderer or DOM.
2. `visible-sun-disc.ts` owns the Three.js mesh, applies placement and
   billboard orientation, evaluates camera-frustum visibility, and disposes
   its resources.

Both modules are exported through the existing visualization barrel. The root
framework barrel already re-exports that barrel, so no root export change is
needed.

The Three.js controller follows the framework's existing factory-and-handle
pattern. The caller supplies the parent and camera explicitly; the component
does not access the WebXR session singleton or register its own frame loop.

The component reuses:

- the framework's existing Three.js peer dependency;
- the logical `THREE.Camera` supplied by live AR, replay, or the demo;
- `isSphereInCameraFrustum()` from `frustum-visibility.ts`;
- `disposeObject3D()` from `three-dispose.ts`;
- the GPS-world NUE scene-root convention established by the shared AR scene
  hierarchy.

For each update, the disc centre is positioned at:

```text
camera world position + normalized NUE sun direction * configured distance
```

The finite distance keeps the icon within the camera's clipping range while
preserving its apparent direction. The mesh copies the camera's world
orientation so its circular face remains directed toward the viewer.

The disc is a procedural `THREE.CircleGeometry` with an unlit
`THREE.MeshBasicMaterial`. Its default size is intentionally an easily visible
icon rather than a physically exact solar angular diameter.

## Visibility and nighttime policy

The returned state distinguishes three cases:

- `visible`: above the NUE horizon and intersecting the camera frustum;
- `outside-view`: above the horizon but not intersecting the camera frustum;
- `below-horizon`: at or below the NUE horizon and hidden by the default
  nighttime policy.

An off-screen arrow, edge marker, or other hint is optional in the project
requirements and is deliberately omitted from this iteration. When an
above-horizon sun is outside the current camera view, the mesh is simply hidden
and the controller returns `outside-view`.

At night, the component parks the mesh at the finite world position represented
by the supplied below-horizon direction but sets `object.visible = false` and
returns `below-horizon`. Continuing to update the parked position is important
for the demo: the hidden sun follows the astronomical path below the horizon
and can reappear at the correct sunrise position without a discontinuous reset.

The horizon rule matches the core's strict `altitude > 0` policy: `y === 0` is
not above the horizon. A `showBelowHorizon` option exists for debugging and
isolated verification, but defaults to `false`.

## Public TypeScript interface

The public API should be:

```ts
import type * as THREE from "three";
import type { NueDirection } from "../geo/sun-position.js";

export type SunDiscVisibility =
  | "visible"
  | "outside-view"
  | "below-horizon";

export interface NuePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VisibleSunDiscOptions {
  /** Distance from the camera in world metres. Must be finite and positive. */
  readonly distance?: number;

  /** Rendered icon diameter in world metres. Must be finite and positive. */
  readonly diameter?: number;

  /** Disc colour accepted by THREE.Color. */
  readonly color?: THREE.ColorRepresentation;

  /** Render below-horizon directions for debugging. Defaults to false. */
  readonly showBelowHorizon?: boolean;
}

export interface VisibleSunDisc {
  /** The owned sun-disc mesh, attached to the parent supplied at creation. */
  readonly object: THREE.Mesh<
    THREE.CircleGeometry,
    THREE.MeshBasicMaterial
  >;

  /**
   * Synchronize placement, billboard orientation, and visibility.
   * Camera world and projection matrices must already be current.
   */
  update(
    directionNue: NueDirection,
    camera: THREE.Camera,
  ): SunDiscVisibility;

  /** Detach the mesh and dispose all resources owned by this instance. */
  dispose(): void;
}

export const DEFAULT_VISIBLE_SUN_DISC: Readonly<{
  distance: number;
  diameter: number;
  color: THREE.ColorRepresentation;
  showBelowHorizon: boolean;
}>;

export function computeSunDiscWorldPosition(
  cameraWorldPosition: NuePosition,
  directionNue: NueDirection,
  distance: number,
): NuePosition;

export function isSunDirectionAboveHorizon(
  directionNue: NueDirection,
): boolean;

export function createVisibleSunDisc(
  parent: THREE.Object3D,
  options?: VisibleSunDiscOptions,
): VisibleSunDisc;
```

Initial defaults should be kept together in `DEFAULT_VISIBLE_SUN_DISC`:

```ts
{
  distance: 10,
  diameter: 0.5,
  color: 0xffd45c,
  showBelowHorizon: false,
}
```

The Sun Position Core guarantees normalized production output. Placement should
not silently renormalize that input and thereby create a second normalization
policy. Runtime checks may reject a zero-length or non-finite direction because
JavaScript callers can bypass TypeScript, but tests must not require exact unit
length equality; a small floating-point tolerance is required.

## Pure and unit-testable behavior

The following behavior remains independent of WebGL and the DOM:

- conversion of camera origin, normalized direction, and distance into a world
  position;
- preservation of the requested camera-to-disc distance;
- above-horizon classification from the NUE `y` component;
- validation of finite, positive distance and diameter;
- validation that direction components are finite and non-degenerate;
- selection of the nighttime state before frustum evaluation.

The Three.js controller is also unit-testable without creating a renderer:

- mesh construction and attachment;
- world placement;
- billboard orientation;
- frustum visibility;
- below-horizon parking and hiding;
- stable scene-object count across repeated updates;
- detachment and resource disposal.

## Test-first implementation strategy

Tests must be added before their corresponding production modules. The first
test run should fail because the new modules and exports do not exist. No test
should use `any`, `@ts-ignore`, unsafe casts, a browser renderer, or duplicated
astronomical calculations.

### Placement tests

Create `sun-disc-placement.test.ts` first with these cases:

- North, South, East, West, and Up place the disc on the expected NUE axes.
- A non-zero camera world position is included in the result.
- Representative normalized diagonal directions put the result at the
  requested distance from the camera within tolerance.
- A positive `y` is above the horizon.
- A negative `y` is below the horizon.
- `y === 0` is not above the horizon.
- Non-finite or non-positive distances are rejected.
- Non-finite and zero-length directions are rejected.

### Three.js controller tests

Create `visible-sun-disc.test.ts` next, using a `THREE.PerspectiveCamera` with
explicitly updated world and projection matrices:

- The factory adds exactly one named circle mesh to the supplied parent.
- Defaults and explicit options configure geometry and material correctly.
- A direction directly in front of the camera returns `visible`.
- Directions beyond each side of the frustum return `outside-view` and hide
  the mesh.
- A direction behind the camera returns `outside-view` and hides the mesh.
- A partially intersecting disc counts as visible through the shared
  sphere-frustum helper.
- A below-horizon direction returns `below-horizon`, moves the mesh to the
  corresponding parked position, and hides it by default.
- `showBelowHorizon: true` bypasses only the horizon rule; normal frustum
  evaluation still applies.
- Transitioning from day to night to day changes visibility without creating a
  new mesh.
- Moving the camera changes the disc origin while preserving direction and
  configured distance.
- Rotating the camera updates billboard orientation and view status without
  changing the supplied world direction.
- Repeated updates do not add scene objects or replace geometry/material.
- Invalid distance and diameter options throw.
- `dispose()` removes the mesh and disposes its geometry and material.
- Multiple instances own and dispose their resources independently.

### Test sequence

1. Add the placement tests and confirm their expected missing-module failure.
2. Implement only enough placement logic to pass them.
3. Add the controller tests and confirm their expected missing-module or
   missing-export failure.
4. Implement only enough Three.js controller behavior to pass them.
5. Add visualization-barrel exports and verify declaration output.
6. Run focused tests, framework typechecks, the complete framework unit suite,
   lint/format checks, and the framework build.
7. Build and manually exercise the isolated demo.

## Automated test success criteria

The automated portion is successful when:

- all cardinal NUE placement assertions pass and deliberate North/South or
  East/West swaps make them fail;
- every computed placement is the configured distance from the camera within
  tolerance;
- horizon classification matches `directionNue.y > 0` exactly;
- invalid numeric configuration and invalid runtime directions are rejected;
- in-frustum, off-frustum, and behind-camera cases produce the documented
  states and mesh visibility;
- below-horizon updates park the mesh at the correct position while keeping it
  hidden by default;
- day/night/day transitions reuse the same mesh and resources;
- billboard orientation follows camera world orientation;
- repeated updates leave the scene-object count unchanged;
- disposal is deterministic and independent between instances;
- existing Sun Position Core and visualization tests remain passing;
- production and test TypeScript checks pass without `any`, `@ts-ignore`, or
  casts that hide errors;
- framework lint, formatting, cycle checks, unit tests, and build pass;
- emitted declarations expose all agreed public types and functions through
  `gps-plus-slam-app-framework/visualization`.

## Isolated demo

Create a separate workspace package named
`GpsPlusSlamJs_VisibleSunDiscDemo`. It consumes production APIs only through
the public workspace package:

```ts
import { calculateSunPosition } from "gps-plus-slam-app-framework/geo";
import { createVisibleSunDisc } from
  "gps-plus-slam-app-framework/visualization";
```

The demo must not repeat SunCalc calls, astronomical equations, or NUE
conversion formulas.

The scene contains:

- a perspective camera and WebGL renderer;
- a horizon/grid and clearly labelled or colour-coded NUE axes;
- the production visible-sun-disc component;
- a fixed observer latitude and longitude, initially Berlin;
- a displayed simulated date and time;
- play/pause, reset, and time-speed controls;
- a manual time slider or equivalent scrub control covering at least one full
  local day;
- a status display showing the core's altitude, NUE direction, above-horizon
  state, and the disc controller's visibility state.

The animation advances a simulated `Date`. At a modest fixed cadence it calls
`calculateSunPosition()` for the fixed location, passes only
`result.directionNue` to `VisibleSunDisc.update()`, and renders the scene. The
astronomical calculation need not run at display refresh rate; updates can be
throttled while rendering remains smooth.

The camera should start with a wide, stable view that makes the horizon and the
daytime arc easy to inspect. Simple orbit controls are allowed for inspection,
but the demo must remain understandable without WebXR, device orientation,
camera permission, or live GPS.

### Demo success criteria

The visual demo is successful when a reviewer can observe all of the following:

- starting from before sunrise and advancing time moves the sun along a smooth,
  directionally consistent arc across the NUE sky;
- the sun emerges at the horizon after the core changes to
  `isAboveHorizon === true`;
- the disc remains visible while above the horizon and inside the camera view;
- at sunset, the core changes to `isAboveHorizon === false`, the controller
  reports `below-horizon`, and the disc becomes hidden;
- during the night the controller continues updating the parked below-horizon
  position without displaying the disc;
- continuing into the next morning makes the same disc instance reappear at
  the correct sunrise side of the horizon, without a jump caused by resetting
  its path;
- pausing and scrubbing across sunrise and sunset reproduces the same positions
  and visibility states deterministically;
- turning the camera away hides an above-horizon disc as `outside-view`, and
  turning back reveals it, with no off-screen hint or arrow;
- the displayed NUE direction remains approximately unit length;
- the demo uses the public production Sun Position Core and Visible Sun Disc
  APIs and contains no duplicate astronomical or coordinate-conversion logic;
- the demo builds and runs independently as a desktop Vite scene.

## Exact files planned

Production files to create:

- `GpsPlusSlamJs_AppFramework/src/visualization/sun-disc-placement.ts`
- `GpsPlusSlamJs_AppFramework/src/visualization/sun-disc-placement.test.ts`
- `GpsPlusSlamJs_AppFramework/src/visualization/visible-sun-disc.ts`
- `GpsPlusSlamJs_AppFramework/src/visualization/visible-sun-disc.test.ts`

Production file to modify:

- `GpsPlusSlamJs_AppFramework/src/visualization/index.ts`

Demo files to create:

- `GpsPlusSlamJs_VisibleSunDiscDemo/package.json`
- `GpsPlusSlamJs_VisibleSunDiscDemo/tsconfig.json`
- `GpsPlusSlamJs_VisibleSunDiscDemo/vite.config.ts`
- `GpsPlusSlamJs_VisibleSunDiscDemo/index.html`
- `GpsPlusSlamJs_VisibleSunDiscDemo/src/main.ts`
- `GpsPlusSlamJs_VisibleSunDiscDemo/src/style.css`

Workspace files to modify when the demo is implemented:

- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `docs/dev-server-ports.md`

This `PLAN.md` is the only file created during planning approval. None of the
other listed files are to be created or modified until implementation is
separately approved.

## In scope

- A reusable Three.js sun-disc/icon visualization in the App Framework.
- Input through the existing normalized `NueDirection` type.
- Placement relative to the current camera while preserving GPS-world NUE
  direction.
- An unlit procedural circular icon that billboards toward the camera.
- Frustum-based visible/outside-view behavior with no off-screen hint.
- Default hiding and continued below-horizon parking at night.
- Explicit update and disposal controlled by the caller.
- Pure placement and horizon-policy functions.
- Test-first unit coverage without requiring WebGL or WebXR.
- A separate desktop demo showing an animated full-day solar arc and
  day/night transitions using the production Sun Position Core.
- Public TypeScript declarations and visualization-barrel exports.

## Out of scope

- Off-screen arrows, edge markers, compass ribbons, or other hints.
- Reusing or extending the wayfinding HUD for the sun.
- Astronomical calculation, SunCalc calls, or NUE conversion inside the visual
  component or demo.
- Live GPS, live clock ownership, replay-state adapters, or application-store
  subscriptions.
- A real-data adapter that combines time, location, and rendering updates.
- WebXR session creation, camera acquisition, or device-orientation handling.
- Calibration, heading correction, magnetic declination, alignment solving,
  or confidence handling.
- Modifying or aiming `DirectionalLight` or `AmbientLight`.
- Light colour, intensity, temperature, atmospheric attenuation, or a broader
  lighting model.
- Shadow maps, shadow casters/receivers, a shadow camera, or a shadow rig.
- Sky shaders, atmospheric scattering, bloom, glare, lens flare, clouds,
  weather, or environment maps.
- Physical solar angular-size accuracy.
- Occlusion of the sun by scene geometry, depth meshes, buildings, terrain, or
  the real environment.
- Sunrise/sunset fades or transitions beyond the strict horizon visibility
  switch.
- Automatic animation-loop registration in the production component.
- Production-site navigation, deployment, or integration into an existing app.

