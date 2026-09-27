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
    the ray-marched slab, plan 2026-09-24-1010; the slab runs at 8 steps,
    the framework's default and the only count the page offers since the
    owner's round 2, `cloudSlabDefine()` reads it back), and the
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
    `casterFlags()` (whether every mesh of each part casts, and whether the
    swatches receive: W3 M1 made every stand-in object cast, since the owner
    saw the spheres cast nothing), `shadowProbe().family` (the lee of the
    Lambert box, a caster standing on the ground), `setWater(id)` (the pond's wave set, W6: `"C0"` for the original six
    waves or a candidate id from `water-candidates.js`, `"P50"` the default
    since the owner rated it best; a new WaterSurface
    per set, hazed, keeping the wave clock) and `waterCandidates()` (the ids,
    today's first); `setFloatingVisible(bool)` (the floating pond, basin and swatches on or
    off: from the city view they stand against the sky, so the sky-pixel tests
    hide them), `floating()` (where the
    pond and the swatches float, W1 M4) and `lakeSurfacePoints(n)` (points
    on the floating pond's surface, which the water test samples);
    `setCity(count, pitch?)` (the dense city, W1 M3: the nearest `count`
    lots of a `pitch` grid; a new pitch rebuilds the part, hazes it and flags
    it as casters when shadows are on), `cityInfo()` (`{ count, max, pitch,
farthest, casts, receives }`) and `drawCalls()` (renders one frame and
    returns its draw calls);
    `setShadows(bool)` (sun shadows, the AR shadow prototype's S1: the
    framework's `createSunShadow` drives the sun light over a 440 m square (R 220 m),
    buildings cast and receive, the ground receives, a 2° floor; while the
    dense city shows, a coarse ring map shadows it out to 2450 m and the
    sun keeps the sharp central map, see [ring-shadow.js](ring-shadow.js.md)
    and the readout's "ring 2450 m"; the central map's camera stands 2480 m
    out, beyond the ring, so it holds every caster), with
    `shadowRenders()` (maps requested, null when off) and `shadowProbe()`
    (a ground point in the tallest building's shadow, its `foot` 0.3 m past
    the footprint, and a diffuse sunlit ground control toward the sun, sunlit
    only with the block alone), `setShadowParams(params)` (the desktop-GPU
    cost sweep: map size, PCF radius, bias, R, every-frame renders) and
    `shadowFlags()`,
    `setHaze(bool)`, `setCloudCover(0…1)`, `setTier("phone" | "desktop")`;
  - `setBloom(bool)` — the bloom pass alone (desktop tier only; throws on
    the phone tier): with it off, the desktop pipeline must draw exactly
    the phone picture;
  - `setSceneMsaa(bool)` — the composer's scene-target MSAA (desktop tier);
  - `setAo(bool)`: screen-space ambient occlusion (round-3 plan
    2026-09-27-0532, stream C; [ambient-occlusion.js](ambient-occlusion.js.md)):
    a switch on either tier, drawn on the desktop tier only (the phone
    tier's plate says so and offers the tier switch); `setAoParams({ params,
denoise, resolutionScale })` is the sweep's handle; `setAoExclusions(bool)`
    (a test surface: off is three's own rule, which draws the sky and the
    clouds into the AO's depth); `aoProbe()` returns the AO checks' world
    points (`crease`, `open`, `far`, a hazed dense-city building's foot
    1.5 km out, null without the dense city, and `ridgeFoot`, 2.5 km toward
    the sun); `stats().aoActive` says whether it draws;
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
  - State lives in the URL hash (`#preset=…&tone=…&tier=…&cloudMode=…&shadows=0|1&city=…&pitch=42|31|20&water=C0|C1|P50|P30|D30&ao=0|1`; defaults since the owner's round 2, plan
    2026-09-26-2055 M2: the densest city, `city=100000&pitch=20`, about
    42,000 buildings, and `water=P50`), so a
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
    1024 (≤ 1 level against the phone tier for every tone mapper), the
    ambient occlusion pass when switched on (built on first use, right
    after the RenderPass; it blends in place and does not swap, so the
    scene target stays the multisampled one), three's
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
- Tests: `lookdev.smoke.spec.mjs` (stage `test:e2e`), `ambient-occlusion.smoke.spec.mjs` (the AO switch and its checks), and `shoot-3d.mjs`.
