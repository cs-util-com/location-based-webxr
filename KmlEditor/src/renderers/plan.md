# KML Features Renderers Component Implementation Plan

## Overview

The `renderers` component is responsible for translating KML feature models (parsed and exposed by the `kml-model` component) into interactive 3D visualizations within a Three.js scene. It coordinates with the `geo-bridge` for coordinate projections and handles asynchronous asset resolving via the `kmz-io` asset provider interface.

### Boundaries & Constraints
*   **What it owns:**
    *   The lifecycle and scene-graph representation of individual KML features (`THREE.Object3D` hierarchies).
    *   Visual representation and rendering configurations of the 4 KML feature types: Markers (`Placemark/Point`), Lines (`Placemark/LineString`), Ground Overlays (`GroundOverlay`), and 3D Models (`Model`).
    *   Interactive handles (vertex edit handles) attached to Line components when selected.
    *   GPU resource allocation and disposal (geometries, materials, textures) associated with its visual elements.
*   **What it never owns:**
    *   The WebGL renderer itself, cameras, orbit controllers, or lighting rigs (owned by `ar-scene` or the desktop previewer).
    *   The global state store, active selection variables, or coordinate transformations (owned by `geo-bridge` and `store`).
    *   KML document mutation and parsing (owned by `kml-model`).
    *   File I/O operations (owned by `persistence` and `kmz-io`).
*   **Contracts Consumed:**
    *   `IFeatureView`, `IMarkerFeature`, `ILineFeature`, `IGroundOverlayFeature`, `IModelFeature` (from `contracts/document-model.ts`)
    *   `IAssetProvider` (from `contracts/kmz-container.ts`)
    *   `IGeoBridge` (from `contracts/geo-bridge.ts`)
*   **Contracts Implemented:**
    *   `IFeatureRenderer` (from `contracts/renderer.ts`)
    *   `IRendererFactory` (from `contracts/renderer.ts`)

---

## Internal Architecture

The component is subdivided into modular units to ensure isolation, testability, and memory safety. A shared texture cache prevents duplicate GPU allocations.

```
                         [ IRendererFactory ]
                                  |
           +----------------------+----------------------+
           |                                             |
 [ IFeatureRenderer ]                          [ IFeatureRenderer ]
(MarkerRenderer, LineRenderer)             (GroundOverlayRenderer, ModelRenderer)
           |                                             |
           +----------------------+----------------------+
                                  |
                       [ TexturePromiseCache ]
                                  |
                          [ THREE.Object3D ]
```

### 1. TexturePromiseCache (Race-Condition Free Texture Cache)
*   **Responsibility:** Manages all loaded `THREE.Texture` instances to prevent GPU memory bloat. Stores promises rather than raw textures to prevent duplicate allocations during concurrent load events.
*   **Operations:**
    *   `acquire(resolvedAssetUrl: string, loader: THREE.TextureLoader): Promise<THREE.Texture>`: Checks for an active promise. If present, returns it and increments reference count. Otherwise, initiates a load and stores the promise.
    *   `release(resolvedAssetUrl: string): void`: Decrements reference count and calls `.dispose()` when count hits zero.
*   **Disposal:** Cleared completely when the workspace document is closed.

### 2. MarkerRenderer
*   **Responsibility:** Renders a camera-facing billboard representation of a Point Placemark.
*   **Inputs:** `IMarkerFeature`, `IAssetProvider`, `IGeoBridge`.
*   **Outputs:** A `THREE.Sprite` referencing the cached texture.
*   **Invariants:** Texture handles are acquired and released through `TexturePromiseCache`. If the image URL changes, the old texture is released and the new one is acquired.

### 3. LineRenderer
*   **Responsibility:** Renders a polyline through the coordinates of a LineString. Manages interactive vertex sphere meshes when selection/editing handles are requested.
*   **Inputs:** `ILineFeature`, `IAssetProvider`, `IGeoBridge`, and an optional selection flag or store subscription.
*   **Outputs:** A `THREE.Line` (or `THREE.LineSegments`) alongside a `THREE.InstancedMesh` for vertex handles.
*   **Invariants:** Shared geometries (e.g. `THREE.SphereGeometry` for vertex handles) are cached at the factory level. Vertex updates are computed in-place using pre-allocated buffers. Instanced rendering is enforced to maintain single draw calls.

### 4. GroundOverlayRenderer
*   **Responsibility:** Renders a quad mesh representing a `GroundOverlay` draped at its target altitude, warped according to a `LatLonBox` and rotated around its center point.
*   **Inputs:** `IGroundOverlayFeature`, `IAssetProvider`, `IGeoBridge`.
*   **Outputs:** A `THREE.Mesh` with depth offsets enabled to prevent z-fighting.
*   **Invariants:** Mesh materials are double-sided. The plane geometry is subdivided into a grid to support draped projection over uneven terrain.

### 5. OrientedImageRenderer (Upright/Vertical Image Plane)
*   **Responsibility:** Renders a vertical plane for free-standing oriented images.
*   **Inputs:** `IMarkerFeature` (representing billboard standees) or specialized descriptor, `IAssetProvider`, `IGeoBridge`.
*   **Outputs:** A `THREE.Mesh` containing a textured double-sided `THREE.PlaneGeometry`.

### 6. ModelRenderer
*   **Responsibility:** Asynchronously loads a COLLADA `.dae` model from the KMZ using `ColladaLoader` and applies heading, tilt, roll, and scale transforms.
*   **Inputs:** `IModelFeature`, `IAssetProvider`, `IGeoBridge`.
*   **Outputs:** A `THREE.Group` wrapping the loaded COLLADA scene graph, or a wireframe fallback bounding box in case of load failure.
*   **Security:** Sanitizes XML inputs to prevent XML External Entity (XXE) expansion attacks before parsing.

---

## Runtime Data Flow

### 1. Initialization and Rendering Flow
1.  The scene container queries the active document and requests renderers from `RendererFactory.createRenderer(feature.type)`.
2.  The container calls `renderer.update(feature, assetProvider, geoBridge)`.
3.  The renderer performs async initialization:
    *   **Textures:** Requests a texture pointer from `TexturePromiseCache.acquire()`.
    *   **Projections:** Computes world positions using `geoBridge.geoToWorld()`.
    *   **COLLADA Models:** Reads `.dae` bytes, sanitizes entities, pre-scans texture nodes, fetches Blob URLs, and configures the `LoadingManager`.
4.  Once resolved, the container adds the `Object3D` back to the scene.

### 2. Feature Editing & Interaction Flow
1.  When an edit command is executed (e.g., vertex drag), the store updates and triggers `renderer.update()`.
2.  The renderer checks if asset paths are unchanged. If unchanged, it updates vertex buffers or transform matrices in-place, bypassing asset re-loads.
3.  Upon selection changes, the line renderer updates the visibility of its child handles group.

### 3. Resource Disposal and Cleanup
1.  When a feature is removed, `renderer.dispose()` is called.
2.  The renderer releases its texture handles back to `TexturePromiseCache`.
3.  All generated Blob URLs are revoked via `URL.revokeObjectURL()`.
4.  Geometries and materials are disposed of from WebGL memory.

---

## Public Surface

No contracts are modified. The classes implement the interfaces defined in `contracts/renderer.ts` exactly.

```typescript
import { IFeatureRenderer, IRendererFactory } from '../contracts/renderer';
import { IFeatureView, FeatureType } from '../contracts/document-model';
import { FeatureId } from '../contracts/type';
import { IAssetProvider } from '../contracts/kmz-container';
import { IGeoBridge } from '../contracts/geo-bridge';
import * as THREE from 'three';

/**
 * Global Reference-Counted Promise Cache for GPU optimization
 */
export class TexturePromiseCache {
    private static cache: Map<string, { promise: Promise<THREE.Texture>, texture: THREE.Texture | null, refCount: number }>;
    
    public static acquire(resolvedAssetUrl: string, loader: THREE.TextureLoader): Promise<THREE.Texture>;
    public static release(resolvedAssetUrl: string): void;
    public static clear(): void;
}

/**
 * Factory class mapping feature types to their respective renderers
 */
export class RendererFactory implements IRendererFactory<THREE.Object3D> {
    private sharedSphereGeometry: THREE.SphereGeometry | null = null;
    private sharedHandleMaterial: THREE.MeshBasicMaterial | null = null;

    createRenderer(featureType: FeatureType): IFeatureRenderer<IFeatureView, THREE.Object3D>;
    public dispose(): void;
}

/**
 * Base implementation class for feature renderers
 */
export abstract class BaseFeatureRenderer<T extends IFeatureView> implements IFeatureRenderer<T, THREE.Object3D> {
    public readonly featureId: FeatureId;
    protected container: THREE.Group;
    protected currentAssetUrls: Map<string, string>; // Maps relative assets to blob URLs

    constructor(featureId: FeatureId);
    
    public abstract update(feature: T, assetProvider: IAssetProvider, geoBridge: IGeoBridge): Promise<void>;
    public getNativeObject(): THREE.Object3D;
    public dispose(): void;
    
    protected cleanupWebGLResources(object: THREE.Object3D): void;
}
```

---

## Algorithms

### 1. Ground Overlay Projection, Subdivision, and Z-Fighting Mitigation

To support draping over uneven terrain and prevent WebGL z-fighting:

1.  **Grid Subdivision:** Instead of a single flat quad, create a plane geometry subdivided into a grid (e.g. $8 \times 8$ segments, resulting in 81 vertices):
    `const geometry = new THREE.PlaneGeometry(1, 1, 8, 8);`
2.  **Corner Calculations in Geographic Space:**
    Compute the unrotated corners of the bounding box in geographic coordinates:
    $$\mathbf{cg}_{\text{NW}} = \{\text{west}, \text{north}\}, \quad \mathbf{cg}_{\text{NE}} = \{\text{east}, \text{north}\}$$
    $$\mathbf{cg}_{\text{SE}} = \{\text{east}, \text{south}\}, \quad \mathbf{cg}_{\text{SW}} = \{\text{west}, \text{south}\}$$
3.  **Bilinear Vertex Interpolation in Geographic Coordinates:**
    For each vertex in the grid with local UV coordinates $(u, v) \in [0, 1] \times [0, 1]$:
    $$\mathbf{cg}(u, v) = (1-u)(1-v)\mathbf{cg}_{\text{SW}} + u(1-v)\mathbf{cg}_{\text{SE}} + u v \mathbf{cg}_{\text{NE}} + (1-u) v \mathbf{cg}_{\text{NW}}$$
4.  **Rotation Math in Geographic Space:**
    Calculate rotation relative to the geographic center point $\mathbf{cg}_{\text{center}}$. Apply the clockwise rotation:
    $$\mathbf{cg}_{lon}' = \mathbf{cg}_{lon} \cos\theta + \mathbf{cg}_{lat} \sin\theta$$
    $$\mathbf{cg}_{lat}' = -\mathbf{cg}_{lon} \sin\theta + \mathbf{cg}_{lat} \cos\theta$$
5.  **Project to World Space:**
    Project each rotated vertex individually to world space, allowing the bridge to resolve local terrain heights for each vertex:
    $$\mathbf{p}(u, v) = \text{geoBridge.geoToWorld}(\{\mathbf{cg}_{lon}', \mathbf{cg}_{lat}', \text{altitude}\}, \text{altitudeMode})$$
6.  **Z-Fighting Material Settings:**
    ```typescript
    const material = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1.0,
        polygonOffsetUnits: -4.0
    });
    ```

### 2. 3D Model Transformation Matrix Construction

Orientation parameters (Roll $\rightarrow$ Tilt $\rightarrow$ Heading) are converted to a right-handed Three.js transform:

```typescript
const euler = new THREE.Euler(
    tiltDegrees * Math.PI / 180,      // X rotation (pitch)
    -headingDegrees * Math.PI / 180,  // Y rotation (yaw, negative due to clockwise rotation)
    -rollDegrees * Math.PI / 180,     // Z rotation (roll, negative to match right-hand axis)
    'YXZ'                             // Apply order: Roll (Z) -> Tilt (X) -> Heading (Y)
);
group.quaternion.setFromEuler(euler);
group.position.copy(geoBridge.geoToWorld(location, altitudeMode));
group.scale.set(scale.x, scale.y, scale.z);
```

### 3. XML Pre-Scanning & Safe DAE Pre-Resolution

To safely identify texture references inside massive COLLADA files without triggering parsing exploits or blocking the main thread:

1.  **Sanitize Entities:** Strip out DOCTYPE declarations to block XXE attacks:
    ```typescript
    const sanitizedDaeText = daeText.replace(/<!DOCTYPE[^>]*>/gi, '');
    ```
2.  **Strip XML Comments:** Strip out comments to prevent comment injection exploits:
    ```typescript
    const commentlessDaeText = sanitizedDaeText.replace(/<!--[\s\S]*?-->/g, '');
    ```
3.  **Regex Pre-Scan:** Scan for texture paths using a namespace-blind, case-insensitive regex match:
    ```typescript
    const texturePaths: string[] = [];
    const regex = /<(?:[a-zA-Z0-9_]+:)?init_from>\s*([^<]+)\s*<\/(?:[a-zA-Z0-9_]+:)?init_from>/gi;
    let match;
    while ((match = regex.exec(commentlessDaeText)) !== null) {
        texturePaths.push(match[1].trim());
    }
    ```
4.  **Blob Resolution:** Map resolved assets asynchronously to local Blob URLs and register them in a synchronous lookup cache. Setup a `LoadingManager` using the cache map before executing `ColladaLoader.load()`.

---

## State Management

| State Element | Owner | Lifetime | Invalidation / Disposal |
| :--- | :--- | :--- | :--- |
| **GPU Texture Cache** | `TexturePromiseCache` | Session-level | Cleared when document closes. |
| **Shared Geometries** | `RendererFactory` | Factory-level | Disposed when factory is destroyed. |
| **Blob URLs** | `BaseFeatureRenderer` | Match target asset | Revoked via `URL.revokeObjectURL()` on update or disposal. |
| **Line Vertex Buffers** | `LineRenderer` | Match line feature | Updated in-place with `DynamicDrawUsage`. |

---

## Error Strategy

*   **Corrupted XML / DAE:** Catch parsing exceptions. Log a warning to the console. Generate a fallback `THREE.BoxHelper` using wireframes at the projected target coordinates.
*   **Missing Textures:** Substitute missing textures with a fallback checkerboard canvas texture (for overlays and models) or a local fallback red pin icon (for markers).
*   **Asset Load Failures:** Apply a 5000ms timeout race. If a texture or file fails to load within the window, cancel the network request and use the placeholder texture/model.

---

## Performance Strategy

*   **Reference-Counted Cache:** Reuses textures across features.
*   **Instanced Edit Handles:** Uses a single `THREE.InstancedMesh` for rendering line vertices, reducing draw calls to 1.
*   **Buffer Recycling:** Updates vertices without allocating new arrays during line adjustments.
*   **Sub-Resource Pre-Parsing:** Uses lightweight regex scanning to bypass full XML parses for texture discovery.
*   **Double-Sided Culling Optimization:** Enabled only on Ground Overlays and Oriented Images to prevent redundant rendering calculations.

---

## Testing Strategy

### 1. Unit Tests (Pure Logic)
*   **Euler Rotation Test:** Verify that orientation rotations (e.g. $h=90, t=45, r=10$) yield the correct quaternion values.
*   **Grid Subdivision Test:** Assert that bilinear interpolation coordinates match boundary projections at different segments.
*   **XML Sanitization Test:** Verify that `<!DOCTYPE` injection vectors are safely removed from KML/DAE inputs.

### 2. Integration & Mock Tests
*   **Texture Cache Reference Tests:** Assert that acquiring a texture twice increments the reference count and only disposes of it when released twice.
*   **Model Degradation Test:** Verify that missing `.dae` assets generate fallback wireframe models.

---

## Demo

The standalone demo will reside in `demos/renderers-demo/index.html` (desktop browser environment using Three.js and OrbitControls).

### Interactive Panel Controls:
1.  **Renderer Sandbox:** Renders one of each feature type (Marker, Line, Ground Overlay, Oriented Image, Model).
2.  **Z-Fighting Simulation:** Toggle between flat ground quads and subdivided quads with polygon offsets.
3.  **Model Rotation Controls:** Real-time heading, tilt, and roll adjustments.
4.  **Error Injection:** Trigger texture load timeout or invalid XML loading to verify fallback degradation.

---

## Dependencies

*   **Three.js (`three`):** The primary 3D library for scene graph rendering.
*   **`three/examples/jsm/loaders/ColladaLoader.js`:** Parses COLLADA `.dae` format files.
*   **`@types/three`:** TypeScript definitions.

---

## Risks

| Risk | Severity | Detection | Mitigation |
| :--- | :--- | :--- | :--- |
| **GPU Memory Leaks** | **High** | Profile memory under repeated document swaps. | Track texture acquisitions and enforce release on disposal. |
| **Main-Thread Lag** | **Medium** | Frame drops in AR during loading. | Offload DAE pre-scans to regex matches and chunk loading. |
| **Z-Fighting on Terrain** | **High** | Visual flicker on overlapping overlays. | Enforce polygon offset limits and coordinate grids. |
