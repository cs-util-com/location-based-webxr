# Architectural Plan: Modular AR Wayfinding HUD for Location-Based WebXR

## 1. Problem Statement and Use Case
In location-based AR environments, points of interest (POIs) and reference markers are anchored to physical world coordinates. Due to the narrow FOV of AR hardware, a majority of these targets reside outside the user's immediate viewport at any given moment. Without navigational affordances, users lack spatial awareness of surrounding anchors. This component introduces an off-screen objective tracking system—commonly utilized in open-world video games—adapted for real-world WebXR applications.

## 2. Objectives and Success Criteria
The component must operate as a modular, reusable building block within a Three.js environment without tight coupling to specific GPS or SLAM networking layers.

**Success Criteria:**
1. **Directional Accuracy:** The system accurately computes the 2D screen-edge vector pointing toward off-screen 3D targets.
2. **State Transitions:** The UI seamlessly transitions between three defined states without flickering:
   * *Off-screen:* Directional arrow clamped to the viewport perimeter.
   * *On-screen (Distant):* Static marker (e.g., a ring) projected onto the target's screen position.
   * *On-screen (Proximate):* No visual indicator required.
3. **Cross-Platform Compatibility:** The visual overlays must render correctly across standard desktop browsers, mobile AR passthrough, and immersive WebXR sessions (e.g., Meta Quest).

## 3. Proposed Methodology and Architecture
To ensure compatibility with immersive WebXR (where DOM-based overlays like `CSS3DRenderer` fail or cause motion sickness), the HUD will be implemented as a frustum-locked 3D UI.

### 3.1 Structural Approach
* **Camera Child Integration:** The UI meshes will be added directly as children of the `THREE.Camera`. This ensures they remain perfectly static relative to the user's viewpoint.
* **Depth Buffer Manipulation:** To simulate an "always-on-top" UI, the HUD materials will utilize `depthTest: false` and `depthWrite: false`, coupled with a high `renderOrder`.

### 3.2 Mathematical Projection Logic
The core algorithmic challenge lies in translating 3D spatial data into viewport-constrained 2D UI transformations.
1. **Normalized Device Coordinates (NDC):** The target's `Vector3` position is projected using the camera's projection matrix.
2. **Local Space Evaluation:** To prevent mirrored projections when targets are located behind the camera plane, the target is converted to the camera's local space via `matrixWorldInverse`. If the local Z-axis is positive, the target is behind the user, necessitating an inversion of the NDC X/Y coordinates.
3. **Edge Clamping:** `Math.atan2` will be utilized to extract the 2D rotation angle. A ray-box intersection algorithm will then clamp the UI marker to the calculated boundaries of the near clipping plane.

## 4. Code Prototyping and Structure

```javascript
import * as THREE from 'three';

/**
 * ARWayfindingHUD manages the frustum-locked spatial indicators.
 */
export class ARWayfindingHUD {
    constructor(scene, camera, hudDistance = 2.5) {
        this.camera = camera;
        this.hudDistance = hudDistance;
        
        // Initialize meshes (geometry and depth-ignoring materials omitted for brevity)
        this.arrowMesh = this._createArrowMesh();
        this.circleMesh = this._createCircleMesh();

        // Bind HUD to the camera transform
        scene.add(this.camera);
        this.camera.add(this.arrowMesh);
        this.camera.add(this.circleMesh);
    }

    /**
     * Evaluates spatial data and updates UI state.
     * @param {THREE.Vector3} targetWorldPos 
     */
    update(targetWorldPos) {
        // 1. Project to NDC
        const ndc = targetWorldPos.clone().project(this.camera);
        
        // 2. Evaluate if target is behind the camera plane
        const localPos = targetWorldPos.clone().applyMatrix4(this.camera.matrixWorldInverse);
        const isBehind = localPos.z > 0; 
        
        // 3. Distance calculation and state routing (Implementation follows)
        // ...
    }
}
```

## 5. Resolved Technical Challenges and Risk Mitigation
To ensure robust performance across varying WebXR environments, the following architectural decisions resolve previously identified risks:

### 5.1 WebXR Stereoscopic Rendering Projection
Standard `Vector3.project(camera)` calculations yield incorrect NDC mappings when applied to the wrapper `ArrayCamera` utilized by immersive headsets. To resolve this, the update loop is designed to dynamically target the physical viewport camera (e.g., `renderer.xr.getCamera().cameras[0]`) during active XR sessions, ensuring accurate physical field-of-view mapping.

```javascript

/**
 * Resolves the active camera, accounting for WebXR stereoscopic rendering.
 * @param {THREE.WebGLRenderer} renderer 
 * @param {THREE.Camera} defaultCamera 
 * @returns {THREE.Camera} The active physical viewport camera.
 */
function getActiveCamera(renderer, defaultCamera) {
    if (renderer.xr.isPresenting) {
        const xrCamera = renderer.xr.getCamera();
        // WebXR provides multiple cameras for stereoscopic views; utilize the primary one for projection
        if (xrCamera.cameras.length > 0) {
            return xrCamera.cameras[0]; 
        }
    }
    return defaultCamera;
}

```

### 5.2 Implementation of State Hysteresis
Micro-movements of the user's head cause rapid UI flickering when targets hover at threshold boundaries. This is mitigated through the implementation of a dual-threshold deadband logic. For example, the 'circle' state activates at a distance of 100m but delays reversion to the 'hidden' state until 95m. Similarly, the 'arrow' transitions to a 'circle' at `|ndc| < 0.8`, but delays reversion until `|ndc| > 0.85`.

```javascript

// Threshold definitions for spatial hysteresis
const DISTANCE_MAX = 100.0;
const DISTANCE_MIN = 95.0;

/**
 * Evaluates state transitions utilizing a Schmitt trigger-inspired deadband logic.
 * @param {number} distance - Distance to the target in meters.
 * @param {string} currentState - The active UI state.
 * @returns {string} The determined new UI state.
 */
function evaluateDistanceHysteresis(distance, currentState) {
    if (currentState === 'circle' && distance < DISTANCE_MIN) {
        return 'hidden'; // Target is now sufficiently close
    } else if (currentState !== 'hidden' && distance >= DISTANCE_MAX) {
        return 'circle'; // Target exceeded maximum visibility threshold
    }
    return currentState; // Maintain current state within the deadband
}

```

### 5.3 VR-Native Distance Labeling
Traditional DOM overlays (such as `CSS2DRenderer` or `CSS3DRenderer`) are incompatible with stereoscopic passthrough and cause visual artifacts. Consequently, all text rendering is executed natively within the WebGL pipeline. Distance readouts are dynamically drawn to an off-screen HTML5 `<canvas>` and subsequently mapped as a `THREE.CanvasTexture` onto a `THREE.Sprite`.

```javascript

/**
 * Generates a VR-safe text sprite utilizing an off-screen canvas context.
 * @param {string} text - The formatted distance string.
 * @returns {THREE.Sprite} A WebGL-compatible 2D text sprite.
 */
function createDistanceLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    
    // Configure and draw the text on the off-screen canvas
    context.fillStyle = '#ffffff';
    context.font = 'bold 32px sans-serif';
    context.textAlign = 'center';
    context.fillText(text, 128, 64);
    
    // Map the canvas to a texture and apply it to a sprite material
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ 
        map: texture, 
        depthTest: false, // Ensure the label renders above scene geometry
        depthWrite: false 
    });
    
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.5, 0.25, 1.0);
    sprite.renderOrder = 1000;
    
    return sprite;
}

```

## 6. Custom Sprite Support for Arrow and Circle Indicators

### 6.1 Motivation
The procedural `ConeGeometry` (arrow) and `RingGeometry` (circle) indicators are sufficient for prototyping but limit visual customizability. To allow integrators to brand the HUD with their own assets without modifying module internals, the `config` object passed to `ARWayfindingHUD` is extended with optional sprite texture references.

### 6.2 Design Decisions
* **Modularity:** The sprite path parameters are optional. If omitted, the module falls back to the existing procedural geometry, preserving backward compatibility.
* **Accepted input types:** Both a URL string (loaded via `THREE.TextureLoader`) and a pre-built `THREE.Texture` instance are valid values, giving callers maximum flexibility.
* **Indicator type switching:** Two independent flags `_useArrowSprite` and `_useCircleSprite` are set during construction based on the presence of the respective sprite config. This allows mixing: e.g. a custom circle sprite with the procedural arrow fallback, or vice versa. The factory methods `_createArrowMesh` / `_createCircleMesh` remain for the fallback path; new methods `_createArrowSprite` / `_createCircleSprite` handle the texture path. `_ensureTargetState` delegates to the correct factory per indicator independently.
* **Arrow sprite orientation:** The arrow asset must point **upward (12 o'clock)** and be centered on the image canvas. The rotation logic applies `atan2` with a `-π/2` offset, meaning an upward-pointing sprite will track the target direction correctly at runtime. This is documented in the constructor JSDoc.
* **Texture loading:** `THREE.TextureLoader` is used synchronously via `.load()`. Because textures are loaded asynchronously, the sprite is created immediately and the material updates automatically once the GPU upload is complete — no additional lifecycle management is required.

### 6.3 Config API Extension

```javascript
const hudConfig = {
    distanceMin: 18.0,
    distanceMax: 20.0,
    hudDistance: 2.5,
    // Optional — omit to keep procedural geometry fallback
    arrowSprite: './src/assets/arrow.png',   // URL string or THREE.Texture
    circleSprite: './src/assets/circle.png', // URL string or THREE.Texture
};
```

### 6.4 Internal Factory Logic

```javascript
_createArrowSprite() {
    const texture = (this._arrowTexture instanceof THREE.Texture)
        ? this._arrowTexture
        : new THREE.TextureLoader().load(this._arrowTexture);
    const material = new THREE.SpriteMaterial({
        map: texture, depthTest: false, depthWrite: false, transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 999;
    sprite.scale.set(0.3, 0.3, 1);
    sprite.visible = false;
    return sprite;
}
```

The circle sprite follows the same pattern with `this._circleTexture`. Arrow rotation is applied via `state.arrowMesh.material.rotation` (not `mesh.rotation`) since `THREE.Sprite` ignores object-level Euler rotation.