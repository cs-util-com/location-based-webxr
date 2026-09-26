# lookdev.js — the 3D look-dev page

- Purpose: show the framework's `SkyAtmosphere` over a stand-in world, with
  presets, sliders, a tone-map A/B, the haze and the cloud layer, and camera
  views, so a look can be judged before it goes into an app (plan
  2026-09-23-0048).
- Public API: none as a module (it is the page's entry). Its test surface
  is `window.__lookdev`:
  - `ready` (true after the first frame; false again while the WebGL
    context is lost), `error` (first page error, or null);
  - `setPreset(id)`, `setToneMapping("agx" | "aces" | "neutral")`,
    `setView("city" | "sun" | "antisun" | "lake" | "aloft" | "inside" | "above")`
    (`aloft`: 2.15 km, just above the sheet; `inside`: 2 km, level, in the
    middle of the slab; `above`: 3.2 km, looking down at the city),
    `setCloudMode("dome" | "sheet" | "slab")` (the fly-through sheet and
    the ray-marched slab, plan 2026-09-24-1010), `setCloudSlabSteps(8 | 16
| 24 | 32)` (the slab's cost knob, also a `Slab steps` select enabled
    only in slab mode, and in the readout as `clouds slab ×16`), and the
    cloud tests' hooks, which act on whichever cloud mesh exists (their
    sheet-era names are kept so the M1 e2e reads unchanged)
    `setCloudOffset(u, v)` (pins the drift so pixels repeat),
    `setCloudSheetVisible(bool)` and `placeCameraAt(eye, target)`;
    `pauseLoop(bool)` (the loop stops drawing its own frames once the page
    is ready; `readPixels` still renders: a slab frame costs about 0.7 s on
    SwiftShader) and `sunDirection()` (the unit vector toward the sun, for
    tests that aim along the sun or away from it);
    `cloudSlabDefine()` (the step count the slab material is built with, so
    a test can tell a count that never reached the program);
    `setCity(count, pitch?)` (the dense city, W1 M3: the nearest `count`
    lots of a `pitch` grid; a new pitch rebuilds the part, hazes it and flags
    it as casters when shadows are on), `cityInfo()` (`{ count, max, pitch,
farthest, casts, receives }`) and `drawCalls()` (renders one frame and
    returns its draw calls);
    `setShadows(bool)` (sun shadows, the AR shadow prototype's S1: the
    framework's `createSunShadow` drives the sun light over a 440 m square (R 220 m),
    buildings cast and receive, the ground receives, a 2° floor), with
    `shadowRenders()` (maps requested, null when off) and `shadowProbe()`
    (a ground point in the tallest building's shadow, and a diffuse sunlit
    ground control toward the sun), `setShadowParams(params)` (the desktop-GPU
    cost sweep: map size, PCF radius, bias, R, every-frame renders) and
    `shadowFlags()`,
    `setHaze(bool)`, `setCloudCover(0…1)`, `setTier("phone" | "desktop")`;
  - `setBloom(bool)` — the bloom pass alone (desktop tier only; throws on
    the phone tier): with it off, the desktop pipeline must draw exactly
    the phone picture;
  - `setSceneMsaa(bool)` — the composer's scene-target MSAA (desktop tier);
  - `readFrame()` → `{ width, height, data }`, the whole drawing buffer
    after one frame (edge comparisons need every pixel);
  - `project([x, y, z])` → normalised canvas `[u, v]` of a world point
    (camera matrices are refreshed in `setView`, so it is exact straight
    after a view change);
  - `advanceWater(seconds)` — step the lake's waves deterministically;
  - `readPixels([[u, v], …])` — renders one frame and reads RGBA bytes at
    normalised canvas points (0,0 = top-left), in the same task so the
    drawing buffer is still valid;
  - `skyPixelParity([u, v])` — renders with tone mapping off and returns
    the canvas's and the CPU model's 8-bit colour for that sky pixel;
  - `stats()` — frame ms, GPU ms (`gpu-timer.js`, `null` without the
    timer extension), LUT ms, draw calls, triangles, state;
  - `parity()` — the GPU/CPU LUT comparison (`parity.js`); atmosphere only.
  - `fallbackParity()` — the framework's CPU fallback sky (`fallbackSky`,
    for devices without float targets) against the GPU sky at the current
    preset: both exposures and both exposure-free horizon colours. The
    fallback's only GPU oracle.
- Invariants & assumptions:
  - State lives in the URL hash (`#preset=…&tone=…&tier=…&cloudMode=…&slabSteps=…&shadows=0|1&city=…&pitch=42|31|20`), so a
    screenshot or phone link reproduces a view; a hash change on an open
    page re-applies it (the page's own writes use `replaceState`, which
    fires no `hashchange`).
  - No baseline any more: the page carried OsmDemo's old Preetham sky as an
    A/B switch until M3, when OsmDemo adopted this same sky model. Its
    GRADING differs: OsmDemo is a data view, Khronos Neutral at exposure
    0.5 / 0.6 with −2.75 EV on natural light (measured against DEC-R4-5's
    margin and the lit city's brightness; real-sun plan 2026-09-23-2149 M3;
    it was ACES at 0.5 with −2 EV before). The page reproduces it with tone
    `neutral` and the exposure slider at −3 EV (exactly 2^−3.01).
  - The atmosphere view uses a 30 km far plane (the ridges reach 9 km) and a
    `THREE.Fog` in the sky's horizon colour: it enables three's fog chunks,
    which the haze replaces, and its near/far give the haze's boundary fade
    (so geometry reaches the sky colour at the far plane, never a hard clip).
    With the haze switched off it is plain stock fog, hiding the clip.
  - The sun light's intensity at the reference elevation is 1.1, OsmDemo's
    value.
  - Exposure: the atmosphere auto-exposes; the slider is compensation in EV.
  - A preset applies sun, visibility and cloud cover with one `configure`
    call (one rebuild); the haze is synced after every change.
  - The haze (`AtmosphereHaze`) patches the stand-in world's materials once
    at load and owns its uniforms, so every atmosphere change only needs a
    `sync`; the haze switch puts it in `'fog'` mode.
  - Clouds drift and the water's waves move in the frame loop; the frame
    delta is clamped to [0, 0.1] s (the first rAF timestamp can precede the
    page's `performance.now()`, which the water rejected).
  - The lake is the framework's `WaterSurface`, set before the haze is
    applied (the haze chains after the water's patch).
  - TIERS (DEC-SKY-9): `phone` (default) caps the pixel ratio at 1.5 and
    draws straight to the canvas; `desktop` allows 2 and renders through a
    composer: HALF-FLOAT targets (as three's own; full float was pure cost
    and can sample black without `OES_texture_float_linear`), 4× MSAA on the
    scene target only (`renderTarget2`, where RenderPass draws; the two
    swapping passes bring it back there every frame), a firefly clamp at
    1024 (≤ 1 level against the phone tier for every tone mapper), three's
    `UnrealBloomPass` (threshold 16, strength 0.1, radius 0.35: a gentle
    glow, swept at the true sun position, see `BLOOM`) and `OutputPass`
    (tone mapping and colour space move there). Every pass is disposed on
    a switch back to phone. The composer is sized at once on a tier switch
    (a new one's targets are 1×1 until sized). The tier is in the URL hash
    (`tier=`).
  - The tiers agree exactly away from edges; AT edges they cannot: the
    composer resolves MSAA in HDR before tone mapping, the canvas after.
  - The GPU timer is re-created after a context restore.
  - Sun ELEVATION and AZIMUTH sliders instead of the plan's single
    time-of-day slider: a superset (every sun position is reachable,
    twilight included, with no date or place needed); recorded as a
    deviation in the plan. OsmDemo now shows the REAL sun for its place and
    date (`sun-clock.ts`, plan 2026-09-23-2149).
- Examples: `pnpm run serve` → `/3d/#preset=blueHour&tone=aces`.
- Tests: `lookdev.smoke.spec.mjs` (stage `test:e2e`), and `shoot-3d.mjs`.
