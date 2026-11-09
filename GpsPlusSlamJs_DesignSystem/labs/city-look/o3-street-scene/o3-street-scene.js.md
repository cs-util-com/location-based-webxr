# o3-street-scene.js

Purpose: the O3 "street scene" variant, a throwaway look prototype on top of V2's buildings. It draws:

- its own roads (`omitToday: ["roads"]`) in one of two join styles: one mitred strip per way (the default), or the library's discs dropped at near-straight points only; sidewalks are lighter than paths, and kerb edges are muted;
- mapped pedestrian areas, flat;
- zebra stripes where they are mapped;
- street lamps, benches, bins and bollards from mapped nodes, instanced, only near the eye.

## Public API

- `o3Variant`: V2's variant with id `o3`, label "O3 street scene", `omitToday: ["roads"]` and its own `objectsFor`.
- Link settings, read once per load: `style` (`mitre`, the default, or `discs`; `joins` and `gap` apply to `discs` only), `joins` (0, 5, 10, 15 or 30 degrees), `gap` (0, 5, 10 or 25 cm; 0 means no limit), `edges` (0 or 1), `marks` (0 or 1), `cut` (40, 80, 150 m or 0 for all). The page's own buttons reload with every setting, because the harness link writer keeps only scene, view, split and heat.
- `window.__o3`: the settings, today's road triangles, a sweep over angle and notch limit, a sweep over the mitre limit (1.5, 2, 3, 4: triangles, mitres, bevels, fallbacks, discs, largest overshoot), the road triangles of both styles, the triangle counts (roads, marks, areas), stripes, zebra ways, furniture counts per kind, triangles per model, and the number of guessed heights.

## Invariants

- One merged road mesh: roads, then marks, then pedestrian areas, normals up, `userData.cityLayer = "roads"`. Kerb edges come through `onBeforeCompile` (an `aStreet` attribute holding offset, half width and edge width).
- Furniture is one `InstancedMesh` per kind:
  - bench and bin are the library's `poiModelFor` models;
  - lamps and bollards are built from the library's `postWithHead`, `box` and `prism`.
    Before each render the near items are repacked, once the eye has moved 4 m. `frustumCulled` is false because `count` changes.
- Furniture is mapped, so nothing on it is flagged cosmetic. Each mesh's `userData.guessed` lists, per item, what is guessed about it (the yaw, and the height where none is tagged).

## Tests

The pure parts are covered in `street-roads.test.mjs` and `street-objects.test.mjs`. The page is checked by the screenshot runs in the O3 report.
