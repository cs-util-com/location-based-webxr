# `scene/sky-dome.ts` — per-palette gradient sky + celestial accents (v3 F3)

## Purpose

Replaces the flat background color above the horizon with one
vertex-colored gradient dome plus palette-specific celestial accents:
dark = moon + deterministic star sprinkle, dusk = low sun disc (a last
sliver above the horizon) + ochre band + silhouette cloud bank
(late-sunset restyle 2026-07-20; a sun-less `"afterglow"` kind also
exists), neon = synthwave star grid, light/mono = the soft gradient
alone.

## Public API

- `buildSkyDome(): Group` — the `sky-dome` group; all accents start
  hidden until a palette applies.
- `applySkyPalette(sky, palette): void` — repaints the dome gradient
  from `palette.sky` (zenith/horizon), toggles exactly that palette's
  accent set, recolors accents with `palette.sky.accentColor` (the
  cloud bank uses `palette.sky.cloudColor`, falling back to
  `accentColor`). Missing nodes are no-ops.
- `domeGradientColorAt(elevation01, palette): Color` — the analytic
  gradient (smoothstep horizon→zenith); exported so tests can pin it.
- `SKY_NODE` — names of all addressable nodes (root, shell, moon,
  stars, sun, horizonBand, starGrid, clouds).

## Invariants & assumptions

- **Fog exclusion:** every sky material has `fog: false`. The dome sits
  at radius 150 while the scene fog ends at ~90 — with fog on it would
  render as a flat fog-colored shell and hide all accents.
- **Draw order:** shell `renderOrder: -10`, accents `-9`, `depthWrite:
false`, `frustumCulled: false` — the sky renders first and the world
  always draws on top.
- **Color-coding invariant untouched:** amber/red/blue roles are not
  used in the sky; all sky colors live in `palette.sky` only.
- **Determinism:** the star sprinkle AND the cloud bank use seeded LCGs
  — two builds are identical (test-pinned; the shoot-script screenshot
  review depends on it).
- The cloud bank lives in the sun's azimuth sector (elevations
  0.12–0.3 rad) so it is in frame for the dive camera; it shows with
  the `"sun"` accent set (dusk: disc + band + clouds) and the sun-less
  `"afterglow"` set (band + clouds, currently unused by palettes).
- The dome is unlit (`MeshBasicMaterial`) and NOT part of the
  `paletteRole` traversal; `scene-controller.applyThemeInternal` calls
  `applySkyPalette` right after `applyPaletteToScene`.

## Examples

```ts
const sky = buildSkyDome();
scene.add(sky);
applySkyPalette(sky, getPalette("dusk")); // sun + band + clouds visible
```

## Tests

`sky-dome.test.ts` — palette sky-block completeness across all five
themes, node-name contract, fog exclusion, depth/render order, star +
cloud determinism, per-palette accent visibility matrix (dusk includes
the cloud bank), cloud tinting via `cloudColor`, analytic gradient
endpoints. Visual truth: `pnpm run shoot` across all palettes.
