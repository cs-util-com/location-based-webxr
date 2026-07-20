# `scene/palette.ts` — per-theme scene palettes + role-based recoloring

## Purpose

Encodes the visual decision of each of the six themes (light = white/matte
clay, dark = night world with glowing accents, neon = cyberpunk, dusk =
the late-sunset teal-and-orange film grade — sun almost done setting,
converged 2026-07-20 over three rounds (golden hour → blue hour → late
sunset), mono =
ink/paper, terminal = hidden CRT) as data, and recolors the whole scene
graph in one traversal via `userData.paletteRole` tags — the mechanism
behind the palette cycle. Also provides the shared mesh/group factories
all scene builders use.

## Public API

- `PALETTE_ROLES` / `PaletteRole` — the closed set of role tags (now
  incl. `portal` = the monument frame and `portalMoss` = its moss clumps
  since the golden-hour portal rebuild).
- `getPalette(theme: Theme) → ScenePalette` — `background`, `fog`,
  `hemisphere` + `directional` light settings, `sky` (v3 F3: zenith/
  horizon gradient colors + `accents` kind + `accentColor` + optional
  `cloudColor` for the dusk cloud blobs + optional `horizonFalloff`
  compressing the warm horizon zone of the dome gradient, consumed by
  `sky-dome.ts` — NOT by the role traversal), `portalInterior` (`{ top, bottom, clouds }` —
  the rebuilt portal's vertex-colored "other world" gradient, consumed by
  `applyPortalPalette` in `portal.ts`, NOT by the role traversal), and
  `roles` (per-role `{ color, emissive?, emissiveIntensity? }`).
- The accent-set union (`"moon-stars" | "sun" | "star-grid" | "none"`)
  is module-private (`SkyAccents`), same knip rule as `RoleStyle`.
- `applyPaletteToScene(root, palette)` — recolors every role-tagged
  `MeshStandardMaterial` under `root` (color + emissive).
- `clayMesh(geometry, role, name?)` — flat-shaded standard-material mesh
  with its own material instance, role tag, and shadows on.
- `namedGroup(name)` — terse named `Group` factory.
- `ScenePalette` type (the per-role style shape `RoleStyle` is
  module-private).

## Invariants & assumptions

- **Every palette defines every role AND the `portalInterior` block**
  (test-pinned) — a missing role would leave meshes in the other theme's
  colors after a cycle.
- **The fused-anchor accent is a per-theme exact map** (test-pinned):
  `#ef4444` everywhere EXCEPT dusk, which runs the deliberately retuned
  crimson `#e0483c` (`DUSK_ACCENT`) matching its CSS `--accent` override.
  A red-family guard (R>190, R−G>100, R−B>100) keeps any future retune
  clearly red.
- **Dusk grade invariants** (test-pinned, late sunset 2026-07-20, 3rd
  round): terrain warm (ground/hill/grass/path R>B — the last direct
  sunlight), vegetation a warm SILHOUETTE pinned relationally (foliage
  R>B and luminance < ½ of ground), the path ≥2× the ground luminance,
  sky zenith cool / horizon warm (the dark zenith also keeps the top-bar
  brand readable), portal frame teal-green (G≥R) with a warm-over-cool
  interior. WCAG readability floors over the dusk background stay
  (skyline ≥2.0, path ≥2.2, statue ≥2.5, phone ≥2.5 + blue-ness) —
  same lesson as the dark-theme floors from round-4.
- **Dusk brightness ceilings** (test-pinned): the world must stay in the
  late-sunset band — luminance ceilings on sky zenith/horizon (≤0.10 /
  ≤0.28) and ground ≤0.08 / hill ≤0.07 / grass ≤0.06 / path ≤0.20, and
  intensity caps (hemisphere ≤0.95, directional ≤0.9 — the sun is a
  sliver on the horizon, not up in the sky). Counterpart of the
  readability floors: floors stop key elements sinking into the
  background, ceilings stop the world drifting back to daylight. The
  path must live between its floor and ceiling.
- Dusk's `fog.color` is deliberately WARMER than `background` (golden
  haze toward the peach horizon); every other theme keeps fog = bg.
- Dark theme glows via `emissiveIntensity > 0`; light theme is matte
  (`0`); dusk stays in a restrained ~0.3–0.6 band ("restrained bloom,
  not neon"). `applyPaletteToScene` always writes all three channels, so
  cycling fully restores the previous look (no sticky state).
- Unknown role strings and non-standard materials are skipped silently —
  a bad tag degrades to "keeps previous color", never a crash.
- `clayMesh` gives each mesh its OWN material instance; sharing across
  roles would corrupt palette application.

## Examples

```ts
const world = buildClayWorld("high");
applyPaletteToScene(world, getPalette("dusk"));
```

## Tests

`palette.test.ts` — role + portalInterior completeness across all six
themes, per-theme accent map + red-family guard, dusk readability floors,
dusk brightness ceilings, dusk grade pins, glow vs. matte, recolor +
toggle-back traversal, unknown-tag/no-tag skipping.
