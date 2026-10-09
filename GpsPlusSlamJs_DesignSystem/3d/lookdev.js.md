# lookdev.js — the 3D look-dev page

- Purpose: show the framework's `SkyAtmosphere` over a stand-in world, with
  presets, sliders, a tone-map A/B, the haze and the cloud layer, and camera
  views, so a look can be judged before it goes into an app (plan
  2026-09-23-0048).
- Public API: none as a module (it is the page's entry). Its test surface
  is `window.__lookdev`:
  - `ready` (true after the first frame; false again while the WebGL
    context is lost), `error` (first page error, or null);
  - THE PRESET GLIDE (round-3 plan 2026-09-27-0532, feedback 1;
    [preset-glide.js](preset-glide.js.md)): `glideToPreset(id)` is what the
    preset BUTTONS do (a 5 s eased glide of every preset value; a click
    mid-glide retargets from where the scene is); `pinGlideClock(ms | null)`
    pins its clock and `glideTick()` runs one glide frame (the paused loop
    leaves the glide to the test), `glideInfo()` (`{ active, id,
rebuildEvery, holdsShadows, shadows }`), `setGlideRebuildEvery(k)` and
    `setGlideShadows("follow" | "freeze")` (the cost sweep's handles) and
    `programIds()` (the programs three holds, for the no-compile check),
    `shadowLightDirection()` (the unit direction the central map renders
    from; null while shadows are off) and `fog()` (the scene's one fog);
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
    `casterFlags()` (`{ casts: { city, dense, catalog, markers, families },
catalogReceives }`: whether every mesh of each part casts, the catalog
    false while it is off, and whether the catalog's spheres receive; W3 M1
    made every stand-in object cast, since the owner saw the spheres cast
    nothing; the old white and gold swatches are a catalog row since round
    3), `shadowProbe().family` (the lee of the
    Lambert box, a caster standing on the ground), `setWater(id)` (the pond's wave set, W6: `"C0"` for the original six
    waves or a candidate id from `water-candidates.js`, `"P50"` the default
    since the owner rated it best; a new WaterSurface
    per set, hazed, keeping the wave clock) and `waterCandidates()` (the ids,
    today's first); the water polish (round-3 plan 2026-09-27-0532, stream
    W, DEC-FB3-9; framework
    [water-polish.ts](../../GpsPlusSlamJs_AppFramework/src/visualization/atmosphere/water-polish.ts.md)),
    ONE SWITCH AND HASH KEY PER TRICK on top of the wave set:
    `setWaterPolish({ lostVariance?, sunSize?, fresnelDamp?, antiTiling?,
gusts?, body? })` (keys `waterRough`, `waterSun`, `waterFresnel`,
    `waterTiles`, `waterGusts`, `waterBody`; a switch not given keeps its
    value; each combination is a new WaterSurface like a wave set),
    `waterPolish()` (the pond's switches), `setWaterPolishParams(values)` /
    `resetWaterPolishParams()` (the sweep's handles: the framework's
    `WaterPolishParams`, kept for every rebuilt surface, no recompile),
    `setWaterTime(s)` (the wave clock, so two looks compare the same waves)
    and `setWaterNormalView(bool)` (test surface: the pond draws its world
    normal as colour, after every other patch, so the smoke measures the
    waves rather than the sky they mirror); `setFloatingVisible(bool)` (the floating pond, basin and
    the catalog, when built, on or off: from the city view they stand against
    the sky, so the sky-pixel tests hide them), `floating()` (where the
    pond and the catalog's spheres float, W1 M4; `catalogMinY` Infinity
    while the catalog is off) and `lakeSurfacePoints(n)` (points
    on the floating pond's surface, which the water test samples);
    `setCity(count, pitch?)` (the dense city, W1 M3: the nearest `count`
    lots of a `pitch` grid; a new pitch rebuilds the part, hazes it and flags
    it as casters when shadows are on), `cityInfo()` (`{ count, max, pitch,
farthest, casts, receives, varied, finish, meshes, materials, instances,
roughness }`: `materials` are the catalog ids of a varied city's meshes,
    or the plain meshes' names; `instances` the lots drawn, summed over the
    meshes) and `drawCalls()` (renders one frame and returns its draw
    calls);
    `setVaried(bool, count?)` (the city's VARIED MATERIALS, round-3 plan
    2026-09-27-0532 DEC-FB3-3, on by default with 12: one InstancedMesh per
    catalog material from the pool `city-materials.js` defines (the
    physically based categories; today the 24 standard entries, the ramp
    row excluded, since the catalog has no physical entry yet), half
    dielectric and half metal, worn by lot seed; a change
    rebuilds the fill, hazed and flagged like a new pitch; `RangeError`
    outside 1..pool size) and `setCityFinish("mixed" | "shiny" | "matte")`
    (the owner's A/B: every city material at roughness 0 or 1, or each at
    its own; a uniform, so the same meshes, draws and programs);
    `timeFrames(n, { shadowMaps?, warmup? })` (the cost handle: a warm-up frame
    unless `warmup: false`, which times the frame right after a change,
    then n frames each ended by a 1-pixel read, `shadowMaps` re-rendering
    both sun maps in each; `{ medianMs, draws, programs }`, relative on
    SwiftShader);
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
  - the material catalog (W5 plan 2026-09-26-0549; on by default since
    round 3): `setCatalog(bool)`, `compileScene()` (compiles every
    material, drawn or not; returns the program count), `catalogInfo()`
    (`{ entries, spheres, visibleLabels, labelIds, programs }`, the labels
    as of the last frame), `catalogSpheres()` (`[{ id, x, y, z }]`, empty
    when off; each with its `label` anchor), `sphereMeshes()`
    (`{ catalog, outside }`: the sphere meshes in and outside the catalog's
    group) and `setLabelRule({ k?, fadeNearM?, fadeFarM? })` (the label
    rule the next frame reads; `RangeError` for a bad rule; the round-3 K
    sweep's handle, default `LABEL_RULE`, 50-140 m, K 16);
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
    clouds into the AO's depth); `aoProbe({ farM })` returns the AO checks'
    world points (`crease`, `open`, `farCrease` with `farCreaseM`, the
    block's farthest visible crease, `far`, a dense-city building's foot
    `farM` (1500) out, null without the dense city, and `ridgeFoot`, 2.5 km
    toward the sun); `stats().aoActive` says whether it draws; on Oculus
    Browser the AO is refused (see the sidecar) and the readout says so;
  - `setSunThroughClouds({ disc?, aureole?, silver? })`: the sun through
    clouds (round-3 plan 2026-09-27-0532, stream D, DEC-FB3-6; framework
    [cloud-sun.ts](../../GpsPlusSlamJs_AppFramework/src/visualization/atmosphere/cloud-sun.ts.md)),
    ONE SWITCH AND HASH KEY PER EFFECT (the owner's requirement): the disc
    dims behind a cloud (k = 4, `sunDisc`), the aureole (`sunAureole`),
    the silver lining (`sunSilver`); all on by default here, off in the
    framework. `setSunLightDim(bool)` (`sunLightDim`, off by default: with
    the cloud shadows on it dims the ground twice) scales the sun light by
    `SkyAtmosphere.cloudTransmittanceToward` at the scene's centre, set
    before every render (it follows the drift); `sunLightDimInfo()`
    returns `{ intensity, base, transmittance }`.
    `setSunThroughCloudsRaw({ discExponent?, aureole?, silverLining? })`
    sets the framework's raw values until the next look change (the
    sweep's handle); `sunCloud()` returns the CPU twins' view of the clouds
    in front of the sun (`{ tau, drawn, noise }`, [sun-clouds.js](sun-clouds.js.md));
    `stats().sunThroughClouds` the framework's values in effect. The view
    `atsun` looks straight at the sun from the street;
  - `setCloudShadows(bool)`: cloud shadows on the ground (DEC-FB3-7; framework
    [cloud-shadow.ts](../../GpsPlusSlamJs_AppFramework/src/visualization/atmosphere/cloud-shadow.ts.md)):
    every lit material is patched once, BEFORE the haze (the catalog, the
    rebuilt dense city and a new water material too), and synced with the
    sky in `useAtmosphere`; on by default here. `cloudShadowAt([x, y, z])`
    returns the CPU twin's share of the sun reaching a world point (the
    same from every viewpoint), and
    `groundAt([[u, v], …])` the ground (or street) world points under
    canvas points (null where something else is hit first);
  - **Hex-tiled clouds** (hex-tiling plan 2026-10-07-0919, H2): one
    switch and hash key (`cloudHex`, the panel's "Clouds without a
    repeating pattern"), off by default and pinned off in every smoke:
    `atmosphere.configure({ cloudHex })`, so the sky, the sheet, the slab
    and the cloud shadow read the big-shape octave hex-tiled (no repeat at
    24 km, the field repeating at 13 tiles). `setCloudHex(on)` for tests.
    Measured by `cloud-hex.smoke.spec.mjs` with the drift pinned.
  - `setGodRays(bool)`: god rays (round-3 look-dev programme, stream G;
    [god-rays.js](god-rays.js.md)), radial screen-space light shafts from
    the sky around the sun, ONE SWITCH AND HASH KEY (`godRays`), off by
    default until the owner has looked, and pinned off in the smoke boot.
    Drawn on both tiers: on the phone tier the page renders through a
    composer while they are on (the desktop pipeline without the bloom:
    the multisampled HDR scene target, the firefly clamp, the rays, the
    OutputPass) and straight to the canvas again when they are off; on the
    desktop tier the pass sits after the bloom, before the OutputPass.
    `setGodRaysParams(values)` is the sweep's handle (the keys of
    `GOD_RAYS`; `RangeError` for a bad value), `godRaysInfo()` returns
    `{ active, x, y, inFront, fade, params, composer }` (the last drawn
    frame's sun point in NDC and fade, and the composer the page renders
    through: `"bloom"`, `"rays"` or null), and `tallestBuilding()` the
    block's tallest building (`{ x, z, sx, sz, h }`), whose edge or wall a
    check puts in front of the sun. The readout adds `god rays (fade …)`

    while they are on. `sceneLuminance([[u, v], …])` renders a frame and
    returns the scene-linear luminance the OutputPass tone-maps there (the
    clamped HDR scene, plus the bloom and the rays when on; needs a
    composer), the scale the mask threshold was chosen on;

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
  - State lives in the URL hash (`#preset=…&tone=…&tier=…&cloudMode=…&shadows=0|1&city=…&pitch=42|31|20&water=C0|C1|P50|P30|D30&catalog=0|1&varied=0|1&materials=1…&finish=mixed|shiny|matte&ao=0|1&sunDisc=0|1&sunAureole=0|1&sunSilver=0|1&cloudShadows=0|1&sunLightDim=0|1&waterRough=0|1&waterSun=0|1&waterFresnel=0|1&waterTiles=0|1&waterGusts=0|1&waterBody=0|1&godRays=0|1&cloudHex=0|1`; defaults since the owner's round 2, plan
    2026-09-26-2055 M2: the densest city, `city=100000&pitch=20`, about
    42,000 buildings, and `water=P50`; since round 3, plan 2026-09-27-0532
    DEC-FB3-5: `shadows=1`, `catalog=1` and `cloudMode=slab`; DEC-FB3-3:
    `varied=1&materials=12&finish=mixed`; stream D: `sunDisc=1&sunAureole=1&sunSilver=1&cloudShadows=1&sunLightDim=0`; stream W: `waterRough=1&waterSun=1&waterFresnel=0&waterTiles=0&waterGusts=1&waterBody=0`; stream G: `godRays=0`; hex-tiling H2: `cloudHex=0`), so a
    screenshot or phone link reproduces a view; a hash change on an open
    page re-applies it (the page's own writes use `replaceState`, which
    fires no `hashchange`). A key the hash does NOT name keeps its CURRENT
    value (the default on load, the page's state on a hash change): the
    on/off keys once read absent as off, which would have made an "on"
    default do nothing for any link without them. One exception keeps old
    links' look: a hash that names `city` but not `varied` (every link
    written before round 3) means `varied=0`. A `materials` count the
    panel does not list is added to its select.
    The smoke boot (`smoke-boot.mjs`) pins the plain scene for every test
    that does not name a key; the opening-state test checks the defaults.
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
  - THE GLIDE (preset-glide.js.md): only the preset buttons glide;
    `api.setPreset` and a link (on load or a `hashchange`) stay instant,
    and a `hashchange`, `setPreset`, `setCloudCover` or a moved slider
    cancels a running glide. A cancelled glide leaves `preset=custom`
    (the look is no preset's) unless the cancelling call names a preset
    itself. A click on the glide's own target, or on the preset already
    shown, does nothing (it would restart the 5 s, or glide nowhere). The frame loop ticks the glide; on its rebuild frames the page
    runs `useAtmosphere` (the sky, the light, the shadow maps) and the
    controls, and the settling frame runs `applyLook` with the preset
    itself, so the end state is the instant preset's exactly. The hash is
    written when the glide settles: `applyLook` writes none while a glide
    runs. The shadow configuration is HELD for the whole glide (on when
    either end casts), so crossing the 2° floor compiles no program
    mid-glide (round-3 plan §8 finding 6). Held below the floor, the maps
    follow the TRUE sun down to 0.1° (it still lights the scene there);
    below 0.1° they render from a sun at 0.1°, same azimuth, because the
    rig refuses a sun at or below the horizon, where the setting disc's
    light fades to 0. The page keeps ONE `THREE.Fog` and recolours it per
    rebuild (a new object would make three re-derive every fogged program
    on the next frame). The readout
    shows `sky … ms` (the whole `useAtmosphere`) and `glide to <id>`.
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
    a switch back to phone. The phone tier builds a composer too while the
    god rays are on (the same pipeline without the bloom and the AO, which
    stays desktop-only); a tier switch or the rays switch rebuilds the
    composer when the kind it needs changes (`composerKind`). The composer is sized at once on a tier switch
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
- Tests: `lookdev.smoke.spec.mjs`, `preset-glide.smoke.spec.mjs` (the
  preset glide, and its on-demand cost and stepping sweep), `lookdev-tidy.smoke.spec.mjs` (the
  round-3 labels, ramp row, varied city and its logged cost) and
  `ambient-occlusion.smoke.spec.mjs` (the AO switch and its checks),
  `water-polish.smoke.spec.mjs` (the water polish: each trick against
  P50 at the same pixels, all off byte-identical, on-demand cost and
  sweeps; metrics in `water-metrics.mjs`),
  `sun-clouds.smoke.spec.mjs` (the sun through clouds, the cloud
  shadows and the sun light dimming against the no-effect baseline, one
  switch per effect, their costs, and the horizon shimmer per cloud mode,
  logged), `god-rays.smoke.spec.mjs` (the god rays against their own
  off baseline, sky only, nothing behind the camera or below the horizon,
  the switch off byte-identical on both tiers, the switch and key, the
  cost; stage `test:e2e`), and `shoot-3d.mjs`. The readout's stats line names the
  city's material count and finish next to the draws.
