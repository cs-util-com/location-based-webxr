# gps-compass-cubes.ts

## Purpose

Creates a group of five colored cubes and text labels indicating cardinal directions (N, E, S, W) and Up, following the NUE convention (X=North, Y=Up, Z=East). Provides immediate visual feedback about GPS-world orientation in AR.

Part of **Issue 8** from user feedback.

## Public API

### `createGpsCompassCubes(parent): GpsCompassCubes`

| Param    | Type             | Description                                                                     |
| -------- | ---------------- | ------------------------------------------------------------------------------- |
| `parent` | `THREE.Object3D` | Node to attach the compass group to (typically the CameraFollower's `object3D`) |

Returns a `GpsCompassCubes` object:

| Member      | Type                     | Description                                                     |
| ----------- | ------------------------ | --------------------------------------------------------------- |
| `group`     | `THREE.Group` (readonly) | The group containing all cubes and labels                       |
| `dispose()` | method                   | Removes group from parent, disposes geometry/materials/textures |

### Constants

| Name                    | Value | Description                       |
| ----------------------- | ----- | --------------------------------- |
| `COMPASS_CUBE_SIZE`     | `0.1` | Side length of each cube          |
| `COMPASS_CUBE_DISTANCE` | `1`   | Distance from center to each cube |

### Cube Layout (NUE Convention)

| Direction | Position     | Color              |
| --------- | ------------ | ------------------ |
| North     | `(1, 0, 0)`  | Red `#ff0000`      |
| East      | `(0, 0, 1)`  | Blue `#0000ff`     |
| South     | `(-1, 0, 0)` | Dim red `#880000`  |
| West      | `(0, 0, -1)` | Dim blue `#000088` |
| Up        | `(0, 1, 0)`  | Green `#00ff00`    |

## Invariants & Assumptions

- Cubes follow NUE convention where X=North, Y=Up, Z=East.
- Text labels are rendered through the shared [text-sprite.ts](text-sprite.ts.md) helper (`createTextSprite`, default static-glyph configuration) — null-safe for jsdom (canvas context may be null). Label naming (`label-<text>`), position above the cube, and scale stay local to this module.
- No label on the Up cube (just a green cube).
- `dispose()` cleans up all geometry, material, and texture resources.

## Tests

- Unit tests: `gps-compass-cubes.test.ts`
  - Hierarchy, positions per NUE, colors, size/distance constants, text labels, no label on Up, dispose.
