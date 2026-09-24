# sun-shadow-rig.ts

## Purpose

Sun-driven shadow rig (DirectionalLight + shadow camera + shadow-catcher) that converts astronomical sun directions into physically grounded, correctly oriented shadows for location-based WebXR and desktop replay. Replaces the framework's fixed, unshadowed directional light with an orthographically framed, shadow-casting rig paired with an invisible shadow-catcher ground plane.

Encapsulates the view-layer GPU configuration (Three.js directional light, shadow map, shadow camera, and `ShadowMaterial` ground plane) while delegating projection and framing math to pure, headless-testable calculation functions.

## Architectural Layering

The module strictly decouples mathematical projection from WebGL/GPU state:

1. **Pure Framing & Placement Math (Headless / Engine-Free)**:
   - `computeShadowFrustum(contentBounds, directionNue, options)`: projects visible content bounding volumes into light view space and calculates tight orthographic frustum planes (`left`, `right`, `top`, `bottom`, `near`, `far`).
   - `computeLightPlacement(targetOrigin, directionNue, distance)`: calculates the 3D position of the directional light along the solar vector pointing toward the target origin.
   - Operates entirely on plain TypeScript numbers and geometry interfaces (`NueDirection`, `Aabb3D`, `Sphere3D`). Has zero dependencies on WebGL contexts, DOM, or GPU drivers, making it 100% deterministic and unit-testable.

2. **View-Layer GPU Configuration (Three.js Scene Adapter)**:
   - `createSunShadowRig(parent, options)` / `SunShadowRig`: manages Three.js scene-graph nodes (`THREE.DirectionalLight`, `light.target`, and `THREE.Mesh` with `THREE.ShadowMaterial`).
   - Configures WebGL shadow map parameters: resolution, depth bias, and normal bias.
   - Synchronizes light transforms, frustum planes, and shadow-catcher position on per-frame updates.
   - Cleans up GPU buffers, materials, and geometries on `dispose()`.

```
┌────────────────────────────────────────────────────────┐
│                   Consumer App / AR Loop               │
└───────────────────────────┬────────────────────────────┘
                            │ (directionNue, contentBounds)
                            ▼
┌────────────────────────────────────────────────────────┐
│      SunShadowRig (View-Layer GPU Configuration)       │
│  ├── THREE.DirectionalLight (castShadow = true)        │
│  ├── THREE.OrthographicCamera (light.shadow.camera)    │
│  └── THREE.Mesh (Shadow-Catcher Ground Plane)          │
└──────────────┬───────────────────────────┬─────────────┘
               │                           │
               ▼                           ▼
┌──────────────────────────────┐ ┌───────────────────────┐
│     computeLightPlacement    │ │ computeShadowFrustum  │
│          (Pure Math)         │ │      (Pure Math)      │
└──────────────────────────────┘ └───────────────────────┘
```

## Public API

```ts
import * as THREE from 'three';
import type { NueDirection } from '../geo/sun-position.js';
import type { SunLightingResult } from '../geo/sun-altitude-lighting.js';

/** Axis-aligned 3D bounding box for shadow framing. */
export interface Aabb3D {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

/** 3D bounding sphere for radial shadow framing. */
export interface Sphere3D {
  readonly center: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly radius: number;
}

/** Content volume passed to frame the shadow camera. */
export type ContentBounds = Aabb3D | Sphere3D;

/** Orthographic camera frustum extents in light view space. */
export interface ShadowFrustum {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly near: number;
  readonly far: number;
}

/** World-space positioning for a directional light shining at a target. */
export interface SunLightPlacement {
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly target: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
}

/** Configuration options for the Sun-driven shadow rig. */
export interface SunShadowRigOptions {
  /**
   * Target focal point in metres towards which the light points.
   * Default: { x: 0, y: 0, z: 0 }.
   */
  readonly targetOrigin?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };

  /**
   * Distance in metres from target along the sun direction vector.
   * Default: 50 m.
   */
  readonly distance?: number;

  /**
   * Shadow map resolution in pixels (square).
   * Default: 2048.
   */
  readonly mapSize?: number;

  /**
   * Constant depth bias to counter shadow acne.
   * Default: -0.0005.
   */
  readonly bias?: number;

  /**
   * Normal-vector bias to eliminate self-shadowing on steep/curved geometry
   * without introducing peter-panning (shadow detachment).
   * Default: 0.03.
   */
  readonly normalBias?: number;

  /**
   * Side length in metres of the square shadow-catcher ground plane.
   * Default: 100 m.
   */
  readonly groundPlaneSize?: number;

  /**
   * Opacity of the ground shadow in [0, 1].
   * 0 = transparent, 1 = solid black.
   * Default: 0.4.
   */
  readonly shadowOpacity?: number;

  /**
   * Base shadow colour for THREE.ShadowMaterial.
   * Default: 0x000000.
   */
  readonly shadowColor?: THREE.ColorRepresentation;

  /**
   * Safety margin scalar applied to the framed bounding volume to prevent edge clipping.
   * Default: 1.15.
   */
  readonly margin?: number;

  /**
   * Default content extent in metres when no dynamic bounds are provided.
   * Configures a default symmetric box [-extent, extent].
   * Default: 15 m.
   */
  readonly defaultContentExtent?: number;
}

/** Lifecycle and update handle for the Sun-driven shadow rig. */
export interface SunShadowRig {
  /** The primary directional light casting solar shadows. */
  readonly directionalLight: THREE.DirectionalLight;

  /** Invisible ground plane mesh that receives and displays shadows. */
  readonly shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;

  /** The light's target Object3D, attached to the scene graph. */
  readonly target: THREE.Object3D;

  /**
   * Update the rig's orientation, shadow camera framing, and lighting.
   *
   * @param directionNue - Normalized sun direction in NUE coordinates.
   * @param contentBounds - Optional bounding volume of visible content to frame tightly.
   * @param lighting - Optional intensity and color model (e.g. from sunAltitudeToLighting).
   */
  update(
    directionNue: NueDirection,
    contentBounds?: ContentBounds,
    lighting?: SunLightingResult
  ): void;

  /** Show or hide shadow-casting and shadow-catcher rendering. */
  setVisible(visible: boolean): void;

  /** Detach nodes from the scene and free GPU resources (geometries, materials, shadow maps). */
  dispose(): void;
}

/** Module defaults pinned across instances. */
export const DEFAULT_SUN_SHADOW_RIG: Readonly<{
  distance: number;
  mapSize: number;
  bias: number;
  normalBias: number;
  groundPlaneSize: number;
  shadowOpacity: number;
  shadowColor: number;
  margin: number;
  defaultContentExtent: number;
  targetOrigin: { readonly x: number; readonly y: number; readonly z: number };
}>;

/**
 * Pure calculation: compute directional light world position shining towards a target.
 *
 * @param targetOrigin - Focal center of the scene (e.g. origin or user position).
 * @param directionNue - Normalized sun direction (+Y up, +X north, +Z east).
 * @param distance - Distance along the sun direction in metres.
 */
export function computeLightPlacement(
  targetOrigin: { readonly x: number; readonly y: number; readonly z: number },
  directionNue: NueDirection,
  distance: number
): SunLightPlacement;

/** Configuration options for orthographic shadow frustum calculation. */
export interface ShadowFrustumOptions {
  /**
   * Distance in metres from target along the sun direction vector.
   * Default: 50 m.
   */
  readonly distance?: number;

  /**
   * Target focal point in metres.
   * Default: { x: 0, y: 0, z: 0 }.
   */
  readonly targetOrigin?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };

  /**
   * Safety margin factor (>= 1.0) applied to the framed bounding volume.
   * Default: 1.15.
   */
  readonly margin?: number;
}

/**
 * Pure calculation: compute tight orthographic frustum extents for a directional light
 * enclosing the specified content volume.
 *
 * @param contentBounds - Bounding box or bounding sphere of visible content.
 * @param directionNue - Normalized sun direction.
 * @param options - Frustum options (distance, targetOrigin, margin) or scalar margin factor.
 */
export function computeShadowFrustum(
  contentBounds: ContentBounds,
  directionNue: NueDirection,
  options?: number | ShadowFrustumOptions
): ShadowFrustum;

/**
 * Factory creating the complete Sun-driven shadow rig attached to a scene.
 *
 * @param parent - Scene or root Object3D (typically the GPS-world scene root).
 * @param options - Rig configuration parameters.
 */
export function createSunShadowRig(
  parent: THREE.Object3D,
  options?: SunShadowRigOptions
): SunShadowRig;
```

## Shadow Camera Framing & Mathematical Derivation

Directional lights project parallel rays along $-\hat{d}_{\text{sun}}$. Their shadow camera is a `THREE.OrthographicCamera` whose view coordinate system $(u, v, w)$ is aligned such that:

- $+w$ points towards the light source ($+\hat{d}_{\text{sun}}$).
- $-w$ points along the forward optical ray direction ($-\hat{d}_{\text{sun}}$).
- $(u, v)$ spans the perpendicular projection plane onto which shadows are cast.

### 1. Light Placement

Given a target focal point $\vec{p}_{\text{target}}$ (by default the scene origin $[0, 0, 0]$):
$$\vec{p}_{\text{light}} = \vec{p}_{\text{target}} + d \cdot \hat{d}_{\text{sun}}$$
where $d$ is `options.distance`. Setting `light.target.position = target` ensures the light looks directly down $-\hat{d}_{\text{sun}}$.

### 2. View Space Orthonormal Basis

To construct the light's view coordinate system:

1. The forward optical ray direction is $\hat{f} = -\hat{d}_{\text{sun}}$.
2. An up reference vector $\vec{\text{up}}_{\text{ref}} = [0, 1, 0]$ (+Y in NUE) is chosen. If the sun is near zenith or nadir ($|\hat{d}_{\text{sun}} \cdot \vec{\text{up}}_{\text{ref}}| > 0.999$), an alternate reference $\vec{\text{up}}_{\text{ref}} = [0, 0, 1]$ (+Z East) is used to avoid gimbal lock.
3. The orthonormal basis vectors are:
   $$\hat{u} = \frac{\hat{f} \times \vec{\text{up}}_{\text{ref}}}{\|\hat{f} \times \vec{\text{up}}_{\text{ref}}\|}, \quad \hat{v} = \hat{u} \times \hat{f}, \quad \hat{w} = -\hat{f} = \hat{d}_{\text{sun}}$$

### 3. Orthographic Frustum Bounds (`computeShadowFrustum`)

To maximize shadow map texel resolution and prevent aliasing, the orthographic camera frustum must tightly bound the visible content rather than using an arbitrary fixed box:

- **For a Bounding Sphere $(\vec{c}, r)$**:
  Project the sphere center $\vec{c}$ relative to the target origin into the view plane:
  $$c_u = (\vec{c} - \vec{p}_{\text{target}}) \cdot \hat{u}$$
  $$c_v = (\vec{c} - \vec{p}_{\text{target}}) \cdot \hat{v}$$
  Because a sphere of radius $r$ is rotationally invariant, its projection onto any orthogonal plane has half-extents $r$.
  With safety margin $m$:
  $$\text{extent} = r \cdot m$$
  $$\text{left} = c_u - \text{extent}, \quad \text{right} = c_u + \text{extent}$$
  $$\text{bottom} = c_v - \text{extent}, \quad \text{top} = c_v + \text{extent}$$
  Depth extents are planar distances measured along the light's forward optical axis ($\hat{f} = -\hat{d}_{\text{sun}}$) from the light position $\vec{p}_{\text{light}}$:
  $$d_{\text{axial}} = (\vec{c} - \vec{p}_{\text{light}}) \cdot (-\hat{d}_{\text{sun}})$$
  $$\text{near} = \max(0.1, d_{\text{axial}} - r \cdot m)$$
  $$\text{far} = d_{\text{axial}} + r \cdot m$$

- **For an Axis-Aligned Bounding Box (AABB)**:
  Project all 8 corner vertices $\vec{v}_k$ of the AABB into the light's view coordinate space:
  $$u_k = (\vec{v}_k - \vec{p}_{\text{target}}) \cdot \hat{u}, \quad v_k = (\vec{v}_k - \vec{p}_{\text{target}}) \cdot \hat{v}, \quad z_k = (\vec{v}_k - \vec{p}_{\text{light}}) \cdot (-\hat{d}_{\text{sun}})$$
  Compute the midpoint and scaled half-extents across all 8 corners:
  $$u_{\text{mid}} = \frac{\min(u) + \max(u)}{2}, \quad w_u = \frac{\max(u) - \min(u)}{2} \cdot m$$
  $$v_{\text{mid}} = \frac{\min(v) + \max(v)}{2}, \quad h_v = \frac{\max(v) - \min(v)}{2} \cdot m$$
  $$\text{left} = u_{\text{mid}} - w_u, \quad \text{right} = u_{\text{mid}} + w_u$$
  $$\text{bottom} = v_{\text{mid}} - h_v, \quad \text{top} = v_{\text{mid}} + h_v$$
  $$\text{near} = \max(0.1, \min(z) - 0.5 \cdot m)$$
  $$\text{far} = \max(z) + 0.5 \cdot m$$

Tightly fitting `near` and `far` along the optical axis is critical: minimizing $(\text{far} - \text{near})$ optimizes depth buffer precision and significantly reduces shadow acne.

## Shadow Tuning & Artifact Prevention

Shadow mapping with high-intensity directional sunlight on mobile WebXR devices is prone to two visual artifacts:

| Artifact                                          | Cause                                                                                          | Mitigation in `SunShadowRig`                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shadow Acne** (Moire / self-shadowing patterns) | Surface geometry quantization and depth map precision limits causing a surface to self-shadow. | Combined `bias: -0.0005` with `normalBias: 0.03`. Normal bias offsets the receiver query along its surface normal, eliminating acne on slopes and curves.  |
| **Peter-Panning** (Detached, floating shadows)    | Excessive depth bias displacing shadows away from contact points.                              | Keeping constant `bias` small and relying primarily on `normalBias` prevents shadow separation at contact feet/bases.                                      |
| **Edge Clipping**                                 | Objects moving outside a static shadow frustum suddenly lose shadows.                          | `margin: 1.15` ensures objects near the boundary do not flicker. Dynamic `update(..., contentBounds)` re-centers and expands the frustum as content grows. |
| **Inverted Night Shadows**                        | Sun direction dropping below horizon ($Y \le 0$) shining from underneath the earth.            | Automatic threshold: when `directionNue.y <= 0`, `directionalLight.castShadow` is disabled and intensity fades to 0.                                       |

## Invisible Shadow-Catcher Ground Plane

In augmented reality, virtual objects must cast shadows onto real-world ground surfaces (sidewalks, grass, floors). Because the real ground is provided by the camera passthrough feed, the 3D ground plane must be visually transparent while continuing to receive and display shadows.

`SunShadowRig` provides an invisible shadow-catcher:

- **Geometry**: `THREE.PlaneGeometry(groundPlaneSize, groundPlaneSize)`, rotated $-\pi/2$ around X to lie flat in the NUE horizontal XZ plane ($Y = 0$, where $+X$ is North, $+Z$ is East).
- **Material**: `THREE.ShadowMaterial({ opacity: options.shadowOpacity, color: options.shadowColor, transparent: true, depthWrite: false })`.
- **Properties**: `receiveShadow = true`, `castShadow = false`.
- **Compositing**: In WebGL, `ShadowMaterial` writes zero color where fully lit (showing camera feed), and darkens pixels proportionally to `opacity` where occluded by shadow casters. `depthWrite = false` prevents the ground plane from occluding virtual objects that intersect or rest on the ground.

## Replacing the Framework's Fixed DirectionalLight

Previously, `ar-scene-hierarchy.ts` constructed a static, non-shadowed directional light:

```ts
// Existing fixed light in ar-scene-hierarchy.ts:
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(0, 10, 5);
newScene.add(directionalLight);
```

`SunShadowRig` replaces this fixed light:

1. **Directional Realism**: Instead of a hardcoded vector $(0, 10, 5)$, the light is positioned dynamically from astronomical calculations ([`sun-position.ts`](../geo/sun-position.ts)).
2. **Shadow Infrastructure**: Activates `directionalLight.castShadow = true`, configures `light.shadow.camera`, tunes biases, and attaches the shadow-catcher.
3. **Photometric Synchronization**: Pairs seamlessly with `sunAltitudeToLighting` from [`../geo/sun-altitude-lighting.ts`](../geo/sun-altitude-lighting.ts) to modulate light color, intensity, and shadow prominence based on solar altitude (dawn, midday, golden hour, twilight).

## Invariants & Assumptions

- **Coordinate System**: All directions and positions follow the framework's **NUE** convention ($+X = \text{North}$, $+Y = \text{Up}$, $+Z = \text{East}$).
- **Parent Node**: The rig must be attached to the **scene root** (GPS-world NUE space), _never_ to `arWorldGroup`. This ensures solar orientation is fixed to geographic directions rather than rotating with AR odometry drift.
- **Normalized Direction**: `directionNue` is expected to be normalized ($\|\vec{d}\| \approx 1$). Non-finite or zero-length inputs throw `TypeError`/`RangeError` in validation.
- **Zenith & Nadir Handling**: When the sun direction is collinear or nearly collinear with the world Up vector ($|\hat{d}_{\text{sun}} \cdot \vec{\text{up}}| > 0.999$), the camera's orthonormal basis calculation switches reference vectors to $+Z$ East ($[0, 0, 1]$), eliminating gimbal lock and matrix degeneracy in `lookAt`.
- **Horizon Policy**: When `directionNue.y <= 0` (sun below horizon), `directionalLight.castShadow` is set to `false` and the shadow catcher is hidden, preventing inverted shadows shining upwards from beneath the ground plane.
- **Ground Alignment**: The shadow catcher plane is aligned horizontally at $Y = 0$ ($R_x = -\pi/2$). Its position in XZ stays centered at `targetOrigin` to cover the active scene area.
- **Pure Functions**: `computeShadowFrustum` and `computeLightPlacement` do not allocate Three.js objects or modify global state.
- **Resource Management**: `dispose()` disposes geometries, materials, shadow map render targets, and detaches nodes from the scene.

## Examples

### 1. Basic Setup & XR Frame Update

```ts
import * as THREE from 'three';
import { createSceneHierarchy } from 'gps-plus-slam-app-framework/ar';
import { createSunShadowRig } from 'gps-plus-slam-app-framework/visualization';
import { calculateSunPosition } from 'gps-plus-slam-app-framework/geo';

const { scene } = createSceneHierarchy();
const userLat = 51.5074;
const userLng = -0.1278;

// Initialize the Sun-driven shadow rig:
const shadowRig = createSunShadowRig(scene, {
  mapSize: 2048,
  groundPlaneSize: 80,
  shadowOpacity: 0.35,
});

// In the animation / XR frame loop:
function onFrame(timestamp: number): void {
  const now = new Date();
  const { directionNue } = calculateSunPosition(now, userLat, userLng);

  // Update shadow rig orientation along the sun direction:
  shadowRig.update(directionNue);
}
```

### 2. Dynamic Framing Around Tracked Content

```ts
import {
  computeShadowFrustum,
  createSunShadowRig,
} from 'gps-plus-slam-app-framework/visualization';

const shadowRig = createSunShadowRig(scene);

// Content bounding box:
const contentBounds = {
  min: { x: -5, y: 0, z: -5 },
  max: { x: 5, y: 3, z: 5 },
};

// Pure math utility calculates tight frustum planes directly:
const frustum = computeShadowFrustum(contentBounds, sunDirectionNue);

// Rig updates both direction and tightly frames the shadow camera:
shadowRig.update(sunDirectionNue, contentBounds);
```

### 3. Integrated Solar Arc & Color Modulation

```ts
import {
  calculateSunPosition,
  sunAltitudeToLighting,
} from 'gps-plus-slam-app-framework/geo';
import { createSunShadowRig } from 'gps-plus-slam-app-framework/visualization';

const shadowRig = createSunShadowRig(scene);

function updateSun(date: Date, lat: number, lng: number): void {
  const sunPos = calculateSunPosition(date, lat, lng);
  const lighting = sunAltitudeToLighting(sunPos.altitudeRad);

  // Updates orientation, intensity, and color in one atomic call:
  shadowRig.update(sunPos.directionNue, undefined, lighting);
}
```

## Tests

- `sun-shadow-rig.test.ts`:
  - **Light Placement**: Verifies directional light position vector equals $d \cdot \vec{d}_{\text{sun}}$ for cardinal NUE directions (North, East, South, West, Zenith).
  - **Shadow Target**: Asserts `light.target` is added to the scene and positioned at the designated origin.
  - **Shadow Camera Framing (Pure Math)**: Tests `computeShadowFrustum` with various bounding boxes and spheres, verifying symmetry, margins, and that all 8 corner vertices remain within $[left, right] \times [bottom, top] \times [near, far]$.
  - **Bias Invariants**: Asserts `bias` and `normalBias` defaults prevent acne and peter-panning.
  - **Shadow Catcher**: Asserts horizontal ground orientation ($R_x = -\pi/2$), `ShadowMaterial` configuration (`transparent = true`, `depthWrite = false`, `receiveShadow = true`).
  - **Horizon Handling**: Asserts that `directionNue.y <= 0` turns off `castShadow` and hides the shadow catcher.
  - **Lifecycle**: Verifies `dispose()` frees geometry, materials, and detaches nodes without memory leaks.
- `sun-shadow-rig.property.test.ts`:
  - Property-based testing over random unit directions $(\theta \in [0, \pi], \phi \in [0, 2\pi])$ asserting invariant coverage: bounded frustum volume, positive depth range ($\text{far} > \text{near} > 0$), and finite extents.

## Consumers

- [`ar-scene-hierarchy.ts`](../ar/ar-scene-hierarchy.ts): provides the replacement path for the fixed directional light.
- `GpsPlusSlamJs_SunPositionDemo`: demonstrates realistic shadows tracking the sun across the sky throughout the day.
- `GpsPlusSlamJs_AnchorStarter` & `GpsPlusSlamJs_MinimalExample`: provides realistic ground contact shadows for placed AR anchors and objects.
