# `scene/scene-controller.ts` — renderer + tick-loop glue

## Purpose

The stateful glue between scroll input, the anime.js story timeline and
the WebGL renderer: owns the `Scene`/camera/lights, applies quality tier
and theme, eases scroll input toward the timeline, drives the intro, and
renders on demand.

## Public API

- `createSceneController(options) → SceneController | null`
  - `options`: `container` (canvas parent + measurements), `tier`
    (`QualityTier`), `initialTheme`, `createRenderer?` (test seam,
    defaults to a real `WebGLRenderer`), `createComposer?` (test seam
    for the v3 F1 post-processing path; default = pmndrs EffectComposer
    with mipmap-blurred selective bloom + vignette; only consulted when
    `tier.postprocessing`), `requestFrame?` (rAF seam).
  - **Returns `null` when renderer creation throws** — the caller falls
    back to the static DOM floor (`body.no-webgl`).
- `SceneController`: `stage`, `setTargetProgress(0..1)`,
  `showChapterEndState(chapterIndex)` (reduced-motion),
  `applyTheme(theme)`, `playIntro()` / `skipIntro()`,
  `handleResize(w, h)`, `setPageVisible(visible)` (v3 F2 visibility
  gate), `clickAt(ndc) → EggClickResult | null` (easter-egg §2 plumbing:
  hit-tests the registered egg targets via `egg-picker.ts`, toggles the
  hit egg — currently the geocache — and reports what happened so
  main.ts can toast; egg transitions run on wall-clock tick time),
  `tick(nowMs)`, `start()`.
- `RendererLike`, `ComposerLike`, `SceneControllerOptions` types (the
  container shape is structural/module-private).

## Invariants & assumptions

- **Render on demand — SUPERSEDED on the high scroll tier (v3 F2):**
  originally a frame rendered only when something changed, so an idle
  page burned no GPU. The ambient particle field consciously relaxes
  this: on `mode === "scroll"` + `geometryDetail === "high"` the page
  renders CONTINUOUSLY so the particles drift — a deliberate battery
  trade-off accepted in the v3 style exploration (F2). The old guarantee
  still holds in full on the low tier and under reduced motion (no
  particle field is even built), and for hidden tabs: the bootstrap
  wires `visibilitychange` AND `pageshow` (round-9 R9-6: bfcache
  restores can skip the visible event) → `setPageVisible`, which stops
  rendering entirely while hidden (all test-pinned).
- **One driver:** `tick(nowMs)` advances everything by seeking; the anime
  engine's own loop is never used. `start()` merely wraps `tick` in rAF.
- **Smoothing:** scroll sets a target; displayed progress converges
  exponentially (τ = 240 ms, raised from 120 after round-1 "hakelig"
  feedback) with an epsilon snap, so wheel steps glide instead of
  jump-cutting.
- **Ambient hero drift:** while resting near the top (scroll mode only,
  intro not active), a gentle time-based sway is layered ADDITIVELY over
  the scrubbed camera pose (`scrubbedCameraPos` holds the pure pose) —
  ramped in over 1.2 s, faded out by ~8 % progress, suppressed under
  reduced motion (all test-pinned). This means the hero renders
  continuously; render-on-demand applies away from the hero.
- Intro playback wins over scrubbing while active; `skipIntro()` seeks it
  to the end AND updates the scrubbed camera base (it previously snapped
  back to the stale intro pose).
- `applyTheme` swaps palette colors, background, fog and light settings in
  place — no scene rebuild. It also repaints the portal interior via
  `applyPortalPalette` (vertex colors can't ride the role traversal).
  Since the golden-hour restyle it also moves
  the directional light to `palette.directional.position` when set (only
  dusk: low-left sun for long sunset shadows) and explicitly RESTORES the
  shared default `(18, 30, 14)` when absent — a sticky dusk position
  would relight every other theme from the wrong side (test-pinned).
- Tier application: `setPixelRatio(tier.dprCap)`, `shadowMap.enabled`,
  world geometry detail (`buildClayWorld(tier.geometryDetail)`).
- Shadows (golden-hour restyle): `shadow.radius = 4` blurs the PCF edges
  (sampled by the default `PCFShadowMap` path — `PCFSoftShadowMap` would
  ignore the radius, so the renderer type is deliberately left default);
  shadow camera bounds are ±38 so dusk's long shadows don't clip, and
  `updateProjectionMatrix()` is called after setting them — without it the
  ortho shadow camera silently keeps its default ±5 box (PR #189 review,
  test-pinned via the projection-matrix elements).
- **Post-processing (v3 F1):** when `tier.postprocessing`, frames render
  through a `ComposerLike` INSTEAD of `renderer.render` (never both).
  The composer owns GPU render targets, so it is **disposed on
  `webglcontextlost` and rebuilt on `webglcontextrestored`** (three.js
  only re-uploads its own resources); while lost/absent the plain render
  path carries the frame. Resizes are forwarded via `composer.setSize`.
  All test-pinned against a fake composer factory.
- Sizes are clamped to ≥ 1px; non-finite progress inputs are ignored.

## Examples

```ts
const scene = createSceneController({
  container: document.getElementById("scene-root")!,
  tier,
  initialTheme: "dark",
});
if (!scene) document.body.classList.add("no-webgl");
scene?.start();
window.addEventListener("scroll", () =>
  scene?.setTargetProgress(storyProgress),
);
```

## Tests

`scene-controller.test.ts` — null on renderer failure, render-on-demand
(no idle re-render), smoothing convergence, reduced-motion end-state seek,
theme swap re-render, intro play/skip landing on the hero framing, DPR/
shadow tier application, resize, composer tier gating (on/off), composer
disposal on context loss + rebuild on restore, composer resize.
