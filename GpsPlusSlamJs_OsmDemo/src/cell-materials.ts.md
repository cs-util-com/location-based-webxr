# `cell-materials.ts`

## Purpose

Builds the affordance grid's two materials — the lit, emissive-patched face
material and the outline material — in a module a test can reach.

## Why it is not in `building-view.ts`

It was, until the r508 review. Both materials were constructed inline inside
`drawCells`, whose only entry point needs a `WebGLRenderer`, so **nothing could
assert anything about them**.

That became a real gap when AR milestone 2 added
`ar-content-materials.test.ts`, which asserts the AR content set stays visible
once the environment map is gone. `SceneContent`'s three members are the
mesh-layer group, `cellMesh` and `cellOutlines`; the guard could only walk the
first. So it covered the layers and skipped the grid — including the **one
material in the AR set carrying an `onBeforeCompile` patch**, which
`installCellEmissive` names as the surface that took the entire scene off screen
for ten work items.

The stand-in was worse than nothing: a test named "the cell grid fades with the
rest of the scene" that actually asserted `CELL_PRESETS.find(…).fog === true` —
a fact about the preset table. Hard-coding `fog: false` in the material would
have broken the behaviour that test named and left it green.

**Nothing about the look changed in the move.** Every value, and every comment
explaining one, came across as-is.

## Public API

- `cellFaceMaterial(preset): MeshStandardMaterial` — the grid's face material
  for a preset. Already patched by `installCellEmissive`.
- `cellOutlineMaterial(): LineBasicMaterial` — the outline material. Takes no
  preset: the outline treatment is a per-cell decision carried in the vertex
  colours (DEC-R3-21), not a look axis.

## Invariants & assumptions

- **A NEW material per call.** `building-view.ts`'s `clear()` disposes what it
  owns and skips children flagged `sharedResources`; a hoisted module constant
  would either be disposed on the first refresh or leak the per-render geometry
  with it. Both failures are silent — three.js does not throw for a disposed
  material.
- **`metalness: 0`, and AR depends on it.** The AR scene has no environment map
  by design, and a metallic material has no diffuse term — it would compile,
  draw, and be black. `ar-content-materials.test.ts` pins this for every preset,
  not just the default, because presets are reachable by hotkey.
- **`fog` comes from the preset and is an axis, not a constant** (§3,
  DEC-R6-22). The "prototype" preset sets it false.
  - Safe today in both modes: the grid covers a ~326 m disc, desktop haze starts
    at 1584 m and AR's at 400 m, so the flag is a no-op.
  - **It stops being one when §6 widens the heat radius**, and in AR the
    consequence is worse than on desktop — fog there ends exactly at the far
    plane, so a material that opts out does not fade, it clips, as a hard edge
    in mid-air. The guard therefore pins the DEFAULT preset's material as
    fogged, and pins that every preset's flag actually reaches its material.
- **`transparent` only when opacity demands it.** A fully opaque preset that
  still declared `transparent: true` would keep paying the transparent render
  pass — no depth write, no early-z, sorted every frame — for nothing.
- **`onBeforeCompile` needs `needsUpdate`.** Harmless on a fresh material,
  correct if one is ever reused; three caches by program, and a compile hook set
  after a program exists never reaches the GPU otherwise.

## Examples

```ts
this.cellMesh = new THREE.Mesh(geometry, cellFaceMaterial(this.cellLook));
this.cellOutlines = new THREE.LineSegments(
  outlineGeometry,
  cellOutlineMaterial(),
);
```

Changing the preset on a LIVE mesh does not go through here —
`BuildingView.setCellPreset` mutates the existing material in place, because the
grid is rebuilt on every publish and a look applied only at the keypress would
revert on the next position change.

## Tests

`ar-content-materials.test.ts` — metalness, `envMap` and the fog-axis link, over
every preset. `cell-presets.test.ts` covers the preset table itself; the e2e
that counts cell pixels is what catches a shader-patch regression, since a
failed compile draws nothing and throws nothing.
