# `surface-colours.ts` — the ground and the plates that lie on it

## Purpose

The two terrain base colours and the **relationship between them**, in one place
so that relationship can be asserted instead of assumed.

## Public API

- `GROUND_COLOUR` — `0x6b7280`, the ground plane (DEC-R6-6).
- `PLATE_COLOUR` — `0x848d9e`, landuse plates (DEC-R6b-7).
- `relativeLuminance(colour: number): number` — WCAG sRGB relative luminance of a
  packed `0xrrggbb`, 0–1.
- `chroma(colour: number): number` — max channel minus min, 0–255.
- `UNDERGROUND_COLOUR` — `0xff7ad9`, the below-surface diagnostic lines, shared
  by the 3D scene and the 2D map (DEC-R11 review, #256).
- `cssColour(colour: number): string` — `#rrggbb` for a packed colour, so a
  value used by a three.js material (which wants the number) and a Leaflet path
  option (which wants the string) has ONE definition.

## Invariants & assumptions

- **Plates are LIGHTER than the ground, ~1.6× in relative luminance.** This is
  the invariant; the exact hex is not. A plate is a surface treatment lying on
  the terrain, and reading darker than what it lies on makes it look like a hole
  punched through the ground.
- **This file exists because that invariant was broken silently.** The two values
  were literals in two files — `building-view.ts` and `mesh-layers.ts` — with
  nothing connecting them. DEC-R6-6 lightened the ground and left the plate
  behind, taking the ratio from ~1.57 to ~0.53. Nothing failed; the next testing
  session reported it as _"riesige schwarze Polygone"_.
- **A plate re-tune must not raise chroma.** DEC-R4-5 requires the affordance
  heat ramp to stay the loudest thing on screen, measured as absolute chroma and
  gated in the e2e suite. `PLATE_COLOUR` sits at chroma 26, below the `0x4a5468`
  it replaced (30) and far below viridis (80–216), so fixing the luminance did
  not trade one regression for another.
- **Both colours stay neutral.** The slope tint needs somewhere to show rather
  than fighting a blue base — DEC-R6-6's argument for the ground, which applies
  equally to what lies on it.

## What this file is NOT

**It is not the cause of the black landuse polygons**, and reading it as such
would leave the real defect unexamined. Those were `plates.ts` emitting its
triangulator output unreversed, so every face normal pointed DOWN and
`flatShading` — which recomputes the face normal from the winding and ignores the
per-vertex normals — lit them from beneath, black under a low sun whatever the
colour said. Fixed there, pinned by `plates.test.ts`'s "winds every triangle so
its face normal points UP". The contrast inversion is a **second, smaller
regression that survived that fix**.

## Examples

```ts
import { GROUND_COLOUR, PLATE_COLOUR } from "./surface-colours.js";

new THREE.MeshStandardMaterial({ color: GROUND_COLOUR, flatShading: true });
new THREE.MeshStandardMaterial({ color: PLATE_COLOUR, roughness: 0.85 });
```

## Tests

`surface-colours.test.ts` — the ordering, the ratio band (1.3–1.9, loose enough
for a deliberate re-tune and tight enough that lightening one constant alone
cannot pass), the chroma ceiling against `0x4a5468` and against viridis, and
anchor checks on `relativeLuminance` so it cannot agree with itself while
disagreeing with the standard.

`underground-lines.test.ts` covers `UNDERGROUND_COLOUR` and `cssColour`: the
colour's distinctness from the rest of the palette, its `#rrggbb` rendering, and
zero-padding — `toString(16)` drops leading zeros, which would silently produce
a five-character string that CSS ignores.

**Why the underground colour lives here rather than beside its geometry.** It
was previously written twice, and the map's copy was not a colour at all: a
`className` with no CSS rule anywhere behind it, so Leaflet drew its default
blue while two sidecars claimed "a colour nothing else uses". One definition in
the palette module is what makes that claim checkable.
