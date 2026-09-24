# Realistic Sun Lighting & Shading AR Demo Plan

## 1. Goal & Overview

Create a standalone, full-fidelity WebXR Augmented Reality demo in `GpsPlusSlamJs_RealisticSunLightingDemo` that demonstrates the cohesive integration of five core solar modules from `gps-plus-slam-app-framework`:

1. **Real Sun Data Adapter** (`createRealSunDataAdapter` from `gps-plus-slam-app-framework/geo`): Manages live GPS and wall-clock inputs alongside fixed location/time simulation overrides, outputting standardized astronomical calculation requests.
2. **Sun Position** (`calculateSunPosition` from `gps-plus-slam-app-framework/geo`): Evaluates solar azimuth, altitude, and North-Up-East (NUE) direction vectors from latitude, longitude, and absolute timestamps.
3. **Visible Sun Disc** (`createVisibleSunDisc` from `gps-plus-slam-app-framework/visualization`): Renders a billboarded, camera-relative sun disc at the astronomical position in the sky dome with horizon visibility and frustum tracking.
4. **Sun Altitude Lighting** (`sunAltitudeToLighting` from `gps-plus-slam-app-framework/geo`): Maps solar altitude angle to physical photometric parameters (direct light intensity, color temperature from night/twilight/golden-hour to midday, and ambient skylight level).
5. **Sun Shadow Rig** (`createSunShadowRig` from `gps-plus-slam-app-framework/visualization`): Controls a shadow-casting `THREE.DirectionalLight` oriented along the solar vector in GPS-world space, tightly frames the shadow camera around placed virtual content, and renders contact shadows onto an invisible `THREE.ShadowMaterial` ground-catcher plane at real-world ground level ($Y = 0$).

The demo serves as the flagship showcase for physically grounded outdoor AR rendering in the repository. Virtual digital objects placed on real-world surfaces cast accurate shadows aligned with the real sun and reflect daylight coloration matching the current time of day and geographic location.

---

## 2. Foundation: Minimal Example Architecture

The demo will be built by adopting the architecture of `GpsPlusSlamJs_MinimalExample` as a template (without altering the original minimal example).

### Key Architectural Principles Retained from Minimal Example
- **App-rendered AR Controller**: Uses `createEnableGpsArController` from `gps-plus-slam-app-framework/ar` to handle WebXR session lifecycle and device capability checks. The UI renders its own button rather than relying on Three.js DOM injection.
- **Scene Graph Parenting**:
  - **Placed Objects & Hit-Test Reticle**: Attached under `getArWorldGroup()` (AR-local space with SLAM drift compensation / alignment lerper).
  - **Sun Shadow Rig & Directional Light**: Attached to `getScene()` (GPS-world NUE space, $+X$ North, $+Y$ Up, $+Z$ East) so solar orientation remains fixed to real cardinal directions regardless of camera odometry resets.
- **Hit-Test Reticle & Tap-to-Place**: Uses `startHitTestReticle` to track real-world horizontal surfaces and register user tap events (`onSelect`).
- **Store & GPS Coordination**: Boots `createSlamAppStore({ storageBackend: new NullStorageBackend() })` and passes incoming GPS fixes via `createGpsPositionHandler` to feed the alignment solver and GPS anchors.
- **DOM Overlay Nesting**: All HUD elements (status panel, mode controls, AR start button) remain child elements of `#ar-root` to composite correctly over the WebXR camera feed.

---

## 3. Demo Features & User Experience

### 3.1 AR Session Activation & Surface Detection
- App displays a landing UI checking WebXR `immersive-ar` and `hit-test` support.
- User clicks "Enable GPS AR" to start the AR session with camera passthrough.
- A visual hit-test reticle projects onto detected real-world horizontal planes (floors, ground, tables).

### 3.2 Digital Object Tap-to-Place
- Once a surface is detected and GPS fix is available, tapping places a realistic, shadow-casting digital 3D object on the real-world surface.
- **Object Design**: A multi-part showcase model (such as a classic sundial with a central gnomon, or an architectural column/statue on a pedestal) built with `THREE.MeshStandardMaterial` ($roughness \approx 0.4$, $metalness \approx 0.1$).
  - Configured with `castShadow = true` and `receiveShadow = true`.
  - The gnomon / column geometry casts a clear, directional shadow across the pedestal and onto the ground plane.
- The object is anchored under `arWorldGroup` using `createGpsAnchor` for drift compensation.
- The object bounds are registered with the shadow rig to tightly frame the orthographic shadow frustum.

### 3.3 Realistic Lighting & Contact Shadows
- **Solar Vector Synchronization**: The directional light in `SunShadowRig` positions itself along $\vec{d}_{\text{sun}}$ in NUE space, pointing toward the scene origin/content.
- **Dynamic Photometric Lighting**: `sunAltitudeToLighting` updates the directional light color and intensity, and sets the scene ambient light.
- **Ground Contact Shadows**: Placed objects cast shadows onto the invisible `ShadowMaterial` ground-catcher plane at $Y = 0$, making virtual objects appear firmly planted on the physical ground.
- **Visible Sun Disc in the Sky Dome**: Looking up toward the calculated solar direction reveals the `VisibleSunDisc` billboarded at the exact azimuth and altitude of the sun. When the sun drops below the horizon, the disc automatically hides and direct shadows extinguish.

### 3.4 Interactive Controls: Live vs. Simulation Modes
A semi-transparent, mobile-friendly HUD overlay allows switching between two modes:
1. **Live Mode (Default)**:
   - Uses real device GPS coordinates from the WebXR position callback and real wall-clock time.
   - Refreshes astronomical calculations periodically (e.g. every 30s) or on new GPS fix.
2. **Time Simulation Mode**:
   - Allows scrubbing time via a 24-hour slider ($00:00 \to 23:59$) or stepping through presets (Dawn, Midday, Golden Hour, Dusk, Night).
   - As the slider moves:
     - The sun disc arcs smoothly across the sky.
     - Lighting shifts dynamically: deep blue-violet twilight $\to$ orange dawn $\to$ crisp white noon $\to$ amber golden hour $\to$ dark night.
     - Shadows swing in azimuth, elongate at low sun angles, shrink at noon, and disappear at night.
3. **Fixed Location Selector / Coordinates**:
   - Allows testing at fixed geographic presets (e.g., Berlin, Equator, Polar) or keeping the current GPS location while scrubbing time.

---

## 4. Package Structure & Exact Files Planned

### 4.1 New Workspace Package
Directory: `GpsPlusSlamJs_RealisticSunLightingDemo/`
Package Name: `gps-plus-slam-realistic-sun-lighting-demo`
Dev Server Port: **5193** (as documented in `docs/dev-server-ports.md`)

```
GpsPlusSlamJs_RealisticSunLightingDemo/
├── .gitignore
├── .prettierignore
├── README.md
├── PLAN.md                               (this file)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts                           # WebXR glue, AR controller, event listeners, frame loop
│   ├── main.ts.md                        # Sidecar documentation for main.ts
│   ├── sun-orchestrator.ts               # Pure orchestrator: connects adapter -> lighting -> shadow rig -> sun disc
│   ├── sun-orchestrator.ts.md            # Sidecar documentation for sun-orchestrator.ts
│   ├── sun-orchestrator.test.ts          # Vitest unit tests for orchestrator logic
│   ├── object-spawner.ts                 # Factory creating the shadow-casting digital object & bounding box
│   ├── object-spawner.ts.md              # Sidecar documentation for object-spawner.ts
│   ├── object-spawner.test.ts            # Vitest unit tests for object creation & material setup
│   ├── status-panel.ts                   # HUD status text & simulation controls view-model
│   ├── status-panel.ts.md                # Sidecar documentation for status-panel.ts
│   ├── status-panel.test.ts              # Vitest unit tests for status formatting & mode transitions
│   ├── style.css                         # Glassmorphic dark HUD styling with touch-friendly sliders
│   └── boot.test.ts                      # Headless smoke test validating imports and store initialization
```

### 4.2 Workspace & Repository Configuration Modifications (when implementing)
- `pnpm-workspace.yaml`: Register `GpsPlusSlamJs_RealisticSunLightingDemo`.
- `docs/dev-server-ports.md`: Document port `5193` for `GpsPlusSlamJs_RealisticSunLightingDemo`.
- `GpsPlusSlamJs_Landing/index.html`: Add a new demo card in the `.demo-grid` linking to `/sun-lighting/`.
- `GpsPlusSlamJs_Landing/index.html.md`: Update documentation to note the new demo card.
- `scripts/build-site.mjs`: Add `GpsPlusSlamJs_RealisticSunLightingDemo` build step (`--base=/sun-lighting/`) into `dist-site/sun-lighting/`.
- `scripts/build-site.mjs.md`: Document the new `/sun-lighting/` distribution route.
- `wrangler.toml` / `GpsPlusSlamJs_SiteWorker`: Ensure `/sun-lighting/*` is served correctly.
- Root `README.md`: Add the new demo to the demo catalog and live link table.

---

## 5. Technical Implementation Specification

### 5.1 Package Configuration (`package.json`)
```json
{
  "name": "gps-plus-slam-realistic-sun-lighting-demo",
  "version": "0.1.0",
  "private": true,
  "description": "Realistic AR lighting and shadow demo combining Real Sun Data Adapter, Sun Position, Visible Sun Disc, Sun Altitude Lighting, and Sun Shadow Rig.",
  "type": "module",
  "scripts": {
    "dev": "pnpm run build:framework && vite",
    "build": "pnpm run build:framework && tsc -p tsconfig.json && vite build",
    "build:framework": "pnpm --filter gps-plus-slam-app-framework run build",
    "preview": "vite preview",
    "test": "node ../scripts/test-timing/run-gate.mjs",
    "test:unit": "node ../scripts/test-timing/timed-stage.mjs test:unit",
    "typecheck": "node ../scripts/test-timing/timed-stage.mjs typecheck"
  },
  "engines": {
    "node": ">=26.0.0"
  },
  "dependencies": {
    "gps-plus-slam-app-framework": "workspace:*",
    "three": "^0.185.1"
  },
  "devDependencies": {
    "@types/node": "^25.9.5",
    "@types/three": "^0.185.4",
    "@types/webxr": "^0.5.24",
    "typescript": "^6.0.3",
    "vite": "^8.2.2",
    "vitest": "^5.0.0"
  },
  "license": "Apache-2.0"
}
```

### 5.2 TypeScript & Build Configuration
- `tsconfig.json`:
```json
{
  "extends": "../tsconfig.demo-base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```
- `vite.config.ts`:
```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5193, // Documented in docs/dev-server-ports.md
    host: true,
  },
});
```

### 5.3 Core Integration: The Solar Pipeline (`src/sun-orchestrator.ts`)
The orchestrator encapsulates the data flow between framework modules:

```ts
import * as THREE from 'three';
import {
  createRealSunDataAdapter,
  sunAltitudeToLighting,
  type RealSunDataAdapter,
  type RealSunDataState,
  type NueDirection,
} from 'gps-plus-slam-app-framework/geo';
import {
  createSunShadowRig,
  createVisibleSunDisc,
  type SunShadowRig,
  type VisibleSunDisc,
  type ContentBounds,
} from 'gps-plus-slam-app-framework/visualization';

export interface SunOrchestrator {
  readonly adapter: RealSunDataAdapter;
  readonly shadowRig: SunShadowRig;
  readonly sunDisc: VisibleSunDisc;
  readonly ambientLight: THREE.AmbientLight;

  updateFrame(camera: THREE.Camera, contentBounds?: ContentBounds): void;
  dispose(): void;
}

export function createSunOrchestrator(deps: {
  scene: THREE.Scene;
  arWorldGroup: THREE.Group;
}): SunOrchestrator {
  const adapter = createRealSunDataAdapter();
  const shadowRig = createSunShadowRig(deps.scene, {
    mapSize: 2048,
    groundPlaneSize: 100,
    shadowOpacity: 0.45,
    bias: -0.0005,
    normalBias: 0.03,
  });
  const sunDisc = createVisibleSunDisc(deps.scene, {
    distance: 15,
    diameter: 0.8,
  });
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
  deps.scene.add(ambientLight);

  let latestDirectionNue: NueDirection | null = null;
  let latestAltitudeRad: number = 0;

  adapter.subscribe((state: RealSunDataState) => {
    if (state.status === 'ready') {
      latestDirectionNue = state.sample.sun.directionNue;
      latestAltitudeRad = state.sample.sun.altitudeRad;

      // 1. Calculate lighting model from altitude angle
      const lighting = sunAltitudeToLighting(latestAltitudeRad);

      // 2. Update ambient light
      ambientLight.intensity = lighting.ambientLevel;
      ambientLight.color.setHex(lighting.color);

      // 3. Update shadow rig orientation, light intensity, and light color
      shadowRig.update(latestDirectionNue, undefined, lighting);
    }
  });

  return {
    adapter,
    shadowRig,
    sunDisc,
    ambientLight,

    updateFrame(camera: THREE.Camera, contentBounds?: ContentBounds): void {
      if (latestDirectionNue) {
        // Update billboard position & frustum visibility for sun disc
        sunDisc.update(latestDirectionNue, camera);

        // Update framed shadow frustum if content bounds provided
        if (contentBounds) {
          const lighting = sunAltitudeToLighting(latestAltitudeRad);
          shadowRig.update(latestDirectionNue, contentBounds, lighting);
        }
      }
    },

    dispose(): void {
      adapter.dispose();
      shadowRig.dispose();
      sunDisc.dispose();
      ambientLight.removeFromParent();
      ambientLight.dispose();
    },
  };
}
```

### 5.4 Digital Object Model (`src/object-spawner.ts`)
A dedicated module creating a sundial / pedestal object configured to maximize shadow contrast:
- Base pedestal (cylinder / beveled box) resting on ground ($Y = 0$).
- Dial plate marked with hour indicators.
- Slanted gnomon rod casting a distinct cast shadow across the dial and ground.
- Pure helper returning `{ mesh: THREE.Group, bounds: ContentBounds }`.

### 5.5 Status & Simulation HUD (`src/status-panel.ts`)
- Displays live GPS fix count, current latitude/longitude, and calculated sun azimuth/altitude.
- Displays current solar phase (Night, Astronomical Twilight, Civil Twilight / Dawn, Golden Hour, Daytime).
- Toggle between **Live Sensor Feed** and **Time Scrubbing**.
- 24-hour slider driving `adapter.setTimeSource({ mode: 'fixed', instant: scrubbedDate })`.
- Location presets (Berlin, London, Tokyo, Sydney, Equator).

### 5.6 Landing Page Button Integration (`GpsPlusSlamJs_Landing/index.html`)
A new `.demo-card` added to the demo grid on the homepage:

```html
<a class="demo-card" href="/sun-lighting/" target="_blank" rel="noopener">
  <svg viewBox="0 0 34 34" aria-hidden="true">
    <circle cx="17" cy="17" r="7" fill="#fbbf24" />
    <path d="M17 3v4M17 27v4M3 17h4M27 17h4M7.1 7.1l2.8 2.8M24.1 24.1l2.8 2.8M7.1 26.9l2.8-2.8M24.1 9.9l2.8-2.8" stroke="#fbbf24" stroke-width="2.2" stroke-linecap="round" />
  </svg>
  <span>
    <strong>Realistic Sun Lighting Demo</strong>
    <small>
      Real-world solar lighting and shadows in AR: combines GPS solar vector calculation, altitude color temperature, visible sun disc in the sky, and directional ground shadows.
    </small>
  </span>
</a>
```

---

## 6. Coding Standards & CONTRIBUTING.md Compliance

All implementation steps strictly adhere to `CONTRIBUTING.md`:
1. **Test-Driven Development (TDD)**:
   - Pure units (`sun-orchestrator.ts`, `object-spawner.ts`, `status-panel.ts`) will have failing tests written first in `.test.ts` files before implementing minimal passing code.
2. **Sidecar Documentation**:
   - Every production file (`*.ts`, `*.html`, `*.config.ts`) must have a corresponding colocated `*.md` sidecar file detailing Purpose, Public API, Invariants, Examples, and Tests.
3. **No Code Duplication & No Dead Code**:
   - Zero duplication of astronomical formulas or shadow projection math; strictly consume `gps-plus-slam-app-framework`.
   - Verified with `jscpd` and `knip`.
4. **No Circular Dependencies**:
   - Enforced by `dpdm`.
5. **Headless Verification**:
   - WebXR hardware-free unit tests and `boot.test.ts` ensuring clean execution in headless CI runners.

---

## 7. Step-by-Step Implementation Roadmap

| Step | Action | Description |
|---|---|---|
| **1** | **Package Setup** | Create `GpsPlusSlamJs_RealisticSunLightingDemo/package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, and register in `pnpm-workspace.yaml` and `docs/dev-server-ports.md`. |
| **2** | **Unit TDD: Object Spawner** | Write `object-spawner.test.ts` $\to$ implement `object-spawner.ts` $\to$ add sidecar `object-spawner.ts.md`. |
| **3** | **Unit TDD: Sun Orchestrator** | Write `sun-orchestrator.test.ts` $\to$ implement `sun-orchestrator.ts` $\to$ add sidecar `sun-orchestrator.ts.md`. |
| **4** | **Unit TDD: Status Panel & View Model** | Write `status-panel.test.ts` $\to$ implement `status-panel.ts` $\to$ add sidecar `status-panel.ts.md`. |
| **5** | **App HTML & Styling** | Create `index.html`, `src/style.css`, and sidecar docs ensuring WebXR DOM-overlay compliance. |
| **6** | **WebXR Main Glue** | Implement `src/main.ts` connecting `createEnableGpsArController`, reticle, store, orchestrator, and UI event handlers. |
| **7** | **Headless Smoke Test** | Implement `src/boot.test.ts` testing store boot and framework module exports. |
| **8** | **Package Documentation** | Write `README.md` with complete usage instructions and architectural diagrams. |
| **9** | **Landing Page & Site Build** | Update `GpsPlusSlamJs_Landing/index.html`, `scripts/build-site.mjs`, and `wrangler.toml` to link and deploy `/sun-lighting/`. |
| **10** | **Full Quality Gate Verification** | Run `pnpm test`, typechecks, linting, `knip`, and build verification across the repository. |

---

## 8. Success Criteria

1. **Module Composition**: Seamlessly fuses `RealSunDataAdapter`, `calculateSunPosition`, `createVisibleSunDisc`, `sunAltitudeToLighting`, and `createSunShadowRig`.
2. **AR Experience**:
   - Starts an immersive WebXR AR session on mobile Chrome.
   - Detects real horizontal surfaces via hit-test reticle.
   - Tap-to-place instantiates a 3D digital object onto the physical surface.
3. **Lighting & Shadow Realism**:
   - Directional light orientation matches the real astronomical sun vector in NUE coordinates.
   - Light color and intensity shift realistically based on sun altitude (night, dawn, golden hour, noon).
   - Placed objects cast realistic contact shadows onto the real-world ground via `ShadowMaterial`.
   - The visible sun disc appears in the sky matching the directional light angle.
4. **Interactive Controls**:
   - Real-time GPS and wall clock drive live lighting.
   - Time scrubbing slider allows previewing full 24-hour solar cycle transitions.
5. **Quality & Repository Conformance**:
   - All tests pass locally and in CI (`pnpm test`).
   - All production files have accompanying sidecars.
   - Landing page includes an accessible, styled demo button leading to `/sun-lighting/`.
   - Isolated dev server port 5193 functions without conflict.
