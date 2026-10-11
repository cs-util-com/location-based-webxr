# three-dispose.ts

## Purpose

Generic Three.js GPU resource cleanup utilities. Provides two functions:

- `disposeObject3D` — traverses an Object3D tree and disposes all geometries, materials, and every texture a material holds in a property of its own (`map`, `normalMap`, `roughnessMap`, ...). Deduplicates shared resources via an internal Set.
- `disposeMeshArray` — convenience wrapper that removes meshes from a parent, calls `disposeObject3D` on each, and clears the array in-place.

## Public API

```ts
export interface DisposeOptions {
  readonly skipGeometry?: boolean;
  readonly skipMaterial?: boolean;
}

export function disposeObject3D(
  root: THREE.Object3D,
  opts?: DisposeOptions
): void;

export function disposeMeshArray(
  meshes: THREE.Mesh[],
  parent?: THREE.Object3D | null,
  opts?: DisposeOptions
): void;
```

### `disposeObject3D(root, opts?)`

- Traverses `root` and all descendants.
- Disposes geometry on Mesh instances (skipped if `opts.skipGeometry`).
- Disposes the material and every `Texture`-valued property of it (by three's `isTexture` flag: `map`, `normalMap`, `emissiveMap`, ...; a texture in two slots once) on Mesh and Sprite instances (skipped if `opts.skipMaterial`). Until the tour kit K4 review (R12) only `map` was freed, which leaked a loaded GLB's other maps.
- A ShaderMaterial's `uniforms` are NOT walked: a uniform often holds a texture another object owns (the camera blit sets its camera texture there), so freeing uniform textures is the caller's decision.
- Shared resources (same geometry/material/texture on multiple objects) are disposed only once.
- Does **not** remove `root` from its parent — callers handle that.

### `disposeMeshArray(meshes, parent?, opts?)`

- Iterates `meshes`, calls `parent.remove(mesh)` (if parent provided), then `disposeObject3D(mesh, opts)`.
- Clears the array in-place (`meshes.length = 0`).

## Invariants & assumptions

- `Mesh.material` can be a single `Material` or `Material[]` (geometry groups) — both are handled.
- Safe to call with an empty array, null parent, or empty group.
- Shared geometries are deduplicated and disposed only once per `disposeObject3D` call.

## Consumers

- `gps-compass-cubes.ts` — `dispose()` via `disposeObject3D(group)`
- `gps-event-markers.ts` — `clearAll()` via `disposeMeshArray()`
- `../ar/camera-blit-capture.ts` — `dispose()` via `disposeObject3D(quad)`

## Tests

- `three-dispose.test.ts` — `disposeObject3D`: single mesh, sprite with texture, group tree traversal, shared geometry dedup, skipGeometry, every texture slot freed once (R12), a ShaderMaterial uniform texture left alone, skipMaterial (material skipped, texture map skipped), empty group, no parent removal, material arrays (dispose all, textures on each, skipMaterial respected). `disposeMeshArray`: parent removal, array clearing, null-parent, skipGeometry, skipMaterial.
