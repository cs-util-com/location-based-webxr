# `scene/portal.ts` — forest portal monument (R14-10, golden-hour rebuild)

## Purpose

A weathered rectangular stone doorway — near-black green, moss-covered,
monumental (≈3.6 × 5.4 units, 4–5× the dot-person) — standing PERMANENTLY
between the trees near the tents. While "Works anywhere. Fully offline."
is on screen (the copy names "a forest with a magic portal that only
opens at dawn"), the story timeline opens a brighter warm "other world"
inside the frame: an unlit vertex-gradient plane (turquoise sky over a
peach horizon) with drifting cloud wisps. Rebuilt 2026-07-19 from the
round-14 glowing cyan disc to match the golden-hour reference image —
see `GpsPlusSlamJs_Docs/docs/2026-07-19-0732-landing-dusk-golden-hour-restyle-plan.md`.

## Public API

- `buildForestPortal(anchor, faceToward): Group` — the `forest-portal`
  group: 4 jittered frame members (`portal` role) + moss clumps
  (`portalMoss` role) + the `portal-interior` subgroup (gradient plane +
  wisps), standing at full scale with the INTERIOR primed closed
  (`scale ~0`) for the timeline. `anchor` is ground level.
- `applyPortalPalette(portal, palette): void` — paints the interior from
  `palette.portalInterior` (vertex gradient bottom→top, wisp tint).
  Frame + moss are NOT touched — they ride the normal role traversal.
  Missing nodes are no-ops. Called by `scene-controller.applyThemeInternal`
  right after `applySkyPalette`.
- `portalInteriorColorAt(elevation01, palette): Color` — the analytic
  interior gradient (smoothstep bottom→top, same shape as
  `domeGradientColorAt`); exported so tests pin the paint analytically.
- `updatePortalSpin(group, timeMs): void` — the interior's ambient life
  (plane breathing 0.97–1.03, wisp drift); pure in the clock. Keeps its
  historical name — the call site in the render loop predates the rebuild.
- `PORTAL_NAME`, `PORTAL_INTERIOR_NAME`.

## Invariants & assumptions

- **The frame NEVER moves** (semantic inversion of the old "whole portal
  pops" contract): the monument is a permanent landmark; the story
  timeline scales ONLY the `portal-interior` subgroup 0→1 (@4200) and
  1→0 (@4820) — open during the far-out works-anywhere moment, closed by
  the city turn (test-pinned, incl. frame-stays-full-scale).
- **A monument, not a glow gate** (inverts the old "gateway, not a wall"
  pin): frame members are opaque, shadow-casting clay boxes; brightness
  comes from the interior being UNLIT (`MeshBasicMaterial`) and
  fog-excluded — inherently brighter than the lit, shadowed, fogged
  world, with zero bloom dependency and no neon (test-pinned).
- **Interior life is clock-pure and never touches the interior group's
  own scale** — that belongs to the timeline; a spin that scaled the
  group would visibly reopen a scrub-closed portal (test-pinned).
- **Deterministic build:** frame jitter, moss and wisps come from a
  seeded LCG — two builds are identical (test-pinned; the shoot-script
  screenshot review depends on it).
- Faces the approaching camera (doorway normal toward `faceToward`).
- The copy word "magic portal" reveals in the matching `--hl-portal`
  turquoise via the scroll-linked fade.
- **Portal-traveler egg (planned N2):** the rebuild is egg-friendly by
  design — stable pickable frame, ground-level doorway, and the egg can
  gate on `interior.scale.x > 0.9` (see the new-easter-eggs plan doc).

## Tests

`portal.test.ts` — standing frame + primed-closed interior, ≥4 opaque
shadow-casting members + taller-than-wide bbox, moss presence, build
determinism, camera facing, unlit/fog-excluded/vertex-colored interior,
analytic gradient endpoints + applied paint, wisp tinting, palette
re-apply (no sticky state), clock-pure breathing/drift bounded and
group-scale-untouched. `story-timeline.test.ts` pins the interior
open/close window + the frame staying full-scale.
