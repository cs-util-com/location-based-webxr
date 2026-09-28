/**
 * The 3D look-dev page: the physical sky (framework `SkyAtmosphere`) over a
 * stand-in world, with presets, sliders, a tone-mapping A/B, the haze and
 * the cloud layer (plan 2026-09-23-0048).
 *
 * THE FRAMEWORK IS LOADED FROM SOURCE: `/fw/…` and `/osm/…` are TypeScript
 * files type-stripped by `serve.mjs`, so what is judged here is the code the
 * apps will run, not a copy. (The page used to carry OsmDemo's old Preetham
 * sky as a baseline switch; it was retired when OsmDemo adopted this sky
 * model in M3. OsmDemo grades it much darker, as a data view: tone
 * `neutral` with exposure −3 EV reproduces it here; exactly
 * 2^−2.75 × 0.5 / 0.6 = 2^−3.01, plan 2026-09-23-2149 M3.)
 *
 * STATE LIVES IN THE URL HASH (`#preset=golden&tone=agx`), like the HUD
 * catalog's, so a screenshot or a phone link reproduces a view.
 *
 * `window.__lookdev` is the page's test surface (smoke test, shoot-3d.mjs).
 * See lookdev.js.md.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { LOOK_PRESETS } from "/fw/visualization/atmosphere/look-presets.js";
import { AtmosphereHaze } from "/fw/visualization/atmosphere/atmosphere-haze.js";
import { fallbackSky } from "/fw/visualization/atmosphere/atmosphere-fallback.js";
import { SkyAtmosphere } from "/fw/visualization/atmosphere/sky-atmosphere.js";
import { CLOUD_SUN } from "/fw/visualization/atmosphere/cloud-sun.js";
import { CloudShadow } from "/fw/visualization/atmosphere/cloud-shadow.js";
import { createSunCloudProbe } from "./sun-clouds.js";
import { WaterSurface } from "/fw/visualization/atmosphere/water-surface-material.js";
import { WATER_CANDIDATES } from "./water-candidates.js";
import { CATALOG } from "./catalog/index.js";
import {
  buildCatalog,
  CATALOG_LAYOUT,
  catalogMaterial,
  createCatalogLabels,
} from "./catalog/catalog-view.js";
import {
  CITY_FINISHES,
  cityMaterialPool,
  DEFAULT_CITY_MATERIALS,
  pickCityMaterials,
} from "./city-materials.js";
import { LABEL_RULE, labelOpacities } from "./catalog/label-rule.js";
import { sunDirection } from "/osm/sun-position.js";
import { smoothstep } from "/osm/easing.js";
import {
  createSunShadow,
  enableSunShadows,
} from "/fw/visualization/sun-shadow.js";
import { sunShadowActive } from "/fw/visualization/sun-shadow-rig.js";

import { createAmbientOcclusion } from "./ambient-occlusion.js";
import { createGpuTimer } from "./gpu-timer.js";
import {
  RING_HALF_WIDTH_M,
  RING_MAP_SIZE,
  withRingShadow,
} from "./ring-shadow.js";
import { lutParity, skyPixelExpected } from "./parity.js";
import { createPresetGlide, presetLook } from "./preset-glide.js";
import {
  buildStandInScene,
  DENSE_PITCHES,
  denseCity,
  FLOAT_HEIGHT_M,
  POND,
} from "./stand-in-scene.js";

const TONE_MAPPINGS = {
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};
/** The sun light at the reference elevation: OsmDemo's value. */
const SUN_INTENSITY = 1.1;
/** The atmosphere view sees the 9 km ridges; the fog only hides the clip. */
const ATMOSPHERE_FAR_M = 30000;
const ATMOSPHERE_FOG_NEAR_M = 20000;
const DEG = Math.PI / 180;
/**
 * The two cost tiers (DEC-SKY-9). PHONE is the always-on base: device pixel
 * ratio capped at 1.5, no post-processing. DESKTOP adds a DPR of up to 2 and
 * bloom through three's own passes (no new dependency).
 */
const TIERS = {
  phone: { maxPixelRatio: 1.5, bloom: false },
  desktop: { maxPixelRatio: 2, bloom: true },
};
/**
 * Bloom runs on the HDR scene before tone mapping, so its threshold is in
 * scene-linear units. SWEPT at golden hour at the TRUE sun position (a first sweep used stale
 * camera matrices and measured the frame's edge): on a physically exposed
 * sky the glow near the sun and a veil over the bright sky come together,
 * glow ≈ 0.45 × the share of the frame brightened by > 30 levels:
 * threshold/strength 8/0.05 → +7.3 glow, 17 % veiled; 16/0.05 → +2.4, 3 %;
 * 16/0.1 → +4.7, 9.7 %; 32/0.2 → +8.0, 19.5 %; 64/0.4 → +13.7, 35 %.
 * (Threshold 4, strength 0.2, the first cut, veiled 52 %.) Shipped: 16/0.1,
 * a gentle glow; the owner judges it on a device. At noon every setting
 * leaves the frame within 0.1 %.
 */
const BLOOM = { strength: 0.1, radius: 0.35, threshold: 16 };
/**
 * The HDR clamp before bloom (a "firefly" clamp), scene-linear. A single
 * pixel far above white (a GGX glint on the water reaches ~1e5; a half-float
 * target stores that as Inf) would otherwise flare across the frame. 1024,
 * not lower: Neutral tone mapping (the page default) does NOT saturate by
 * ~16, and a clamp at 64 shifted saturated highlights by up to 8 levels
 * against the phone tier; at 1024 the shift is at most 1 level for every
 * tone mapper (M4 review, finding 6, swept 16...60 000).
 */
const HDR_CLAMP = 1024;
const clampShader = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: HDR_CLAMP } },
  vertexShader: `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
void main() { gl_FragColor = min(texture2D(tDiffuse, vUv), vec4(uMax)); }`,
};

const api = { ready: false, error: null };
window.__lookdev = api;
const fail = (message) => {
  api.error = api.error ?? message;
  document.body.dataset.error = "true";
  const box = document.querySelector("[data-error-box]");
  if (box) box.textContent = message;
};
window.addEventListener("error", (e) => fail(String(e.message ?? e)));
window.addEventListener("unhandledrejection", (e) => fail(String(e.reason)));

const canvas = document.querySelector("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, ATMOSPHERE_FAR_M);
camera.position.set(-240, 55, 270);
const controls = new OrbitControls(camera, canvas);
controls.target.set(40, 20, 0);
controls.update();
const sun = new THREE.DirectionalLight(0xffffff, 1);
scene.add(sun, sun.target);
const parts = buildStandInScene(scene);
// The lightweight water (M4) replaces the lake's placeholder; applied BEFORE
// the haze below, so the haze chains after the water's patch.
let water = new WaterSurface();
parts.lake.material.dispose();
parts.lake.material = water.material;
// The cloud shadows (round-3 stream D, DEC-FB3-7) and the haze patch the
// world's materials ONCE; each owns its uniforms, so an atmosphere change
// (or a rebuilt atmosphere) only needs a sync. The cloud shadows go first:
// the haze is applied last (its own contract).
const cloudShadow = new CloudShadow();
cloudShadow.applyToObject(scene);
const haze = new AtmosphereHaze({ visibilityKm: 45 });
haze.applyToObject(scene);

// --- state -----------------------------------------------------------------

const initial = LOOK_PRESETS.find((p) => p.id === "golden");
const state = {
  preset: initial.id,
  elevation: initial.sunElevationDeg,
  azimuth: initial.sunAzimuthDeg,
  visibility: initial.visibilityKm,
  exposureEv: initial.exposureEv,
  clouds: initial.cloudCover,
  tone: "neutral",
  haze: true,
  tier: "phone",
  // Dome (the sky's layer), the fly-through sheet, or the ray-marched slab
  // (plan 2026-09-24-1010 §11); the slab by default since the owner's
  // round 3 (plan 2026-09-27-0532, DEC-FB3-5).
  cloudMode: "slab",
  // Sun shadows (AR sun shadow plan 2026-09-23-2343, M2 / S1); on by
  // default since round 3 (DEC-FB3-5).
  shadows: true,
  // The dense city (programme plan 2026-09-26-0539, W1 M3): the nearest
  // `count` lots of a `pitch` grid; 0 is the block alone. The default is
  // the densest, about 42,000 buildings (owner, round-2 plan 2026-09-26-2055
  // M2).
  city: 100000,
  pitch: 20,
  // The pond's wave set (W6): "C0" is the original six built-in waves, the
  // others the candidates the owner rated (water-candidates.js); P50 rated
  // best (round-2 plan 2026-09-26-2055 M2).
  water: "P50",
  // The material catalog (W5 plan 2026-09-26-0549 M1): on by default since
  // round 3 (DEC-FB3-5); the smoke boot pins it off, so the page's other
  // tests never compile its programs (smoke-boot.mjs).
  catalog: true,
  // Screen-space ambient occlusion (round-3 plan 2026-09-27-0532, stream C):
  // drawn on the desktop tier only, where the composer exists; off by
  // default (plan Q3-1).
  ao: false,
  // The dense city's varied materials (round-3 plan 2026-09-27-0532,
  // DEC-FB3-3): on by default, `materials` catalog entries from the city
  // pool (city-materials.js; today the standard entries without the ramp
  // row) worn at random by lot; `finish` is the owner's A/B
  // ("mixed", each material's own roughness, "shiny" or "matte").
  varied: true,
  materials: DEFAULT_CITY_MATERIALS,
  finish: "mixed",
  // The sun through clouds (round-3 plan 2026-09-27-0532, stream D,
  // DEC-FB3-6), ONE SWITCH PER EFFECT so the owner can judge each alone:
  // the disc dims behind a cloud far faster than the sky (sunDisc), thin
  // cloud glows a few degrees around the sun (sunAureole), thin backlit
  // edges brighten further out (sunSilver). On by default here, for the
  // owner to judge; the framework's default is off. The smoke boot pins
  // them off.
  sunDisc: true,
  sunAureole: true,
  sunSilver: true,
  // Cloud shadows on the ground (DEC-FB3-7): the sun's direct light dimmed
  // per pixel by the cloud column toward it, in every lit material. On.
  cloudShadows: true,
  // The sun light as a whole dimmed by the cloud column over the scene's
  // centre (the brief's candidate). Off by default: with the cloud shadows
  // on it dims the ground twice (the record's open question).
  sunLightDim: false,
};

/** The catalog entries a city building may wear (city-materials.js). */
const CITY_POOL = cityMaterialPool(CATALOG);
const isMaterialCount = (n) =>
  Number.isInteger(n) && n >= 1 && n <= CITY_POOL.length;

const WATER_IDS = ["C0", ...WATER_CANDIDATES.map((c) => c.id)];
/** The wave set the pond's current material was built with. */
let waterId = "C0";

/**
 * The shadow parameters. R 220 m covers the whole stand-in city (7 × 42 m
 * blocks and their shadows), not the AR prototype's 25 m around the user.
 * `setShadowParams` is the manual desktop-GPU cost sweep's handle (plan §4 /
 * §7 item 7: N, PCF radius, normal bias, R, and `everyFrame` to time a map
 * render).
 */
const shadowParams = {
  halfWidthM: 220,
  mapSize: 2048,
  radius: 1,
  normalBiasTexels: 1,
  bias: 0,
  everyFrame: false,
};
/**
 * The look-dev page shows shadows down to a 2° sun, the dawn preset's own
 * elevation, so dawn casts too (the floor is inclusive); AR keeps the rig's
 * 10° floor.
 */
const SHADOW_FLOOR_DEG = 2;
let sunShadow = null;
/**
 * The ring shadow (round-2 plan M2b): a light with no intensity whose coarse
 * map shadows the dense city past the central map. Present while shadows are
 * on and the dense city shows. The chunk rewrite is inert with one shadow.
 */
THREE.ShaderChunk.lights_fragment_begin = withRingShadow(
  THREE.ShaderChunk.lights_fragment_begin,
);
let ringShadow = null;
/** The central map's camera distance from the centre (see applyShadows). */
const SUN_SHADOW_DISTANCE_M = RING_HALF_WIDTH_M + 30;
/**
 * The parts besides the city and the dense fill that cast (W3 plan M1). The
 * catalog's spheres cast and receive by themselves (catalog-view.js).
 */
const CASTING_PARTS = ["markers", "families"];
/** The switch is on but the sun is below the floor (the readout says so). */
let shadowsBelowFloor = false;

const CLOUD_MODES = ["dome", "sheet", "slab"];
const VIEWS = [
  "city",
  "sun",
  "atsun",
  "antisun",
  "lake",
  "aloft",
  "inside",
  "above",
  "catalog",
];
/** Drift on unless a test pins the offset (pixel tests need a fixed sky). */
let cloudDrift = true;
/** The CPU twins of the clouds in front of the sun (test surface). */
const sunCloudProbe = createSunCloudProbe();

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const preset = LOOK_PRESETS.find((p) => p.id === params.get("preset"));
  if (preset) applyPresetToState(preset);
  if (params.get("tone") in TONE_MAPPINGS) state.tone = params.get("tone");
  if (params.get("tier") in TIERS) state.tier = params.get("tier");
  if (CLOUD_MODES.includes(params.get("cloudMode"))) {
    state.cloudMode = params.get("cloudMode");
  }
  // A key the hash does not name keeps its CURRENT value: on load that is
  // the default, on a hash change whatever the page shows (round-3 plan §8
  // finding 5: reading absent as off made a default of "on" do nothing for
  // every link without the key).
  if (params.has("shadows")) state.shadows = params.get("shadows") === "1";
  if (params.has("catalog")) state.catalog = params.get("catalog") === "1";
  if (params.has("ao")) state.ao = params.get("ao") === "1";
  if (params.has("sunDisc")) state.sunDisc = params.get("sunDisc") === "1";
  if (params.has("sunAureole")) {
    state.sunAureole = params.get("sunAureole") === "1";
  }
  if (params.has("sunSilver"))
    state.sunSilver = params.get("sunSilver") === "1";
  if (params.has("sunLightDim")) {
    state.sunLightDim = params.get("sunLightDim") === "1";
  }
  if (params.has("cloudShadows")) {
    state.cloudShadows = params.get("cloudShadows") === "1";
  }
  if (WATER_IDS.includes(params.get("water"))) {
    state.water = params.get("water");
  }
  const pitch = Number(params.get("pitch"));
  if (DENSE_PITCHES.includes(pitch)) state.pitch = pitch;
  // Links from before round 3 name `city` (the page always wrote it) but
  // never `varied`: they mean the plain city they were shared with
  // (round-3 review, finding 7).
  if (params.has("varied")) state.varied = params.get("varied") === "1";
  else if (params.has("city")) state.varied = false;
  const materials = Number(params.get("materials"));
  if (isMaterialCount(materials)) state.materials = materials;
  if (Object.hasOwn(CITY_FINISHES, params.get("finish") ?? "")) {
    state.finish = params.get("finish");
  }
  const city = Number(params.get("city"));
  // Only when the hash names it: a link without `city` keeps the default
  // (the dense city since round 2), like every other key.
  if (params.has("city")) {
    state.city = Number.isFinite(city) && city > 0 ? Math.floor(city) : 0;
  }
}

function writeHash() {
  const params = new URLSearchParams({
    preset: state.preset,
    tone: state.tone,
    tier: state.tier,
    cloudMode: state.cloudMode,
    shadows: state.shadows ? "1" : "0",
    city: String(state.city),
    pitch: String(state.pitch),
    water: state.water,
    catalog: state.catalog ? "1" : "0",
    ao: state.ao ? "1" : "0",
    varied: state.varied ? "1" : "0",
    materials: String(state.materials),
    finish: state.finish,
    sunDisc: state.sunDisc ? "1" : "0",
    sunAureole: state.sunAureole ? "1" : "0",
    sunSilver: state.sunSilver ? "1" : "0",
    cloudShadows: state.cloudShadows ? "1" : "0",
    sunLightDim: state.sunLightDim ? "1" : "0",
  });
  history.replaceState(null, "", `#${params}`);
}

function applyPresetToState(preset) {
  state.preset = preset.id;
  state.elevation = preset.sunElevationDeg;
  state.azimuth = preset.sunAzimuthDeg;
  state.visibility = preset.visibilityKm;
  state.exposureEv = preset.exposureEv;
  state.clouds = preset.cloudCover;
}

// --- the preset glide (round-3 plan 2026-09-27-0532, feedback 1) -------------

/**
 * The sky's rebuild interval during a glide, in frames (preset-glide.js):
 * the LUTs, the environment bake and both shadow maps together, every 2nd
 * frame. Swept over 1, 2, 4, 8 on the page's defaults (preset-glide
 * results, 2026-09-27; SwiftShader ratios only): a rebuild costs 0.84-0.90
 * of a steady frame, 0.69 of it the shadow maps, so a glide frame averages
 * 1.84-1.90x at 1, 1.42-1.45x at 2, 1.21-1.22x at 4. On SwiftShader, 2 is
 * the one interval inside the declared 1.5x budget that still steps at
 * 30 Hz on a 60 fps screen (at most 1.7° of sun and a 95th-percentile jump
 * of 9 levels per step at the glide's fastest); 4 steps at 15 Hz, up to
 * 3.4° a step, and is the fallback.
 * NOT MEASURED ON A REAL GPU: every rebuild reads the sky-view LUT back
 * synchronously (SkyAtmosphere's exposure measurement, a readPixels), which
 * stalls a GPU pipeline in a way the CPU rasteriser cannot show. On a
 * phone, a frame is either on time or a whole refresh late, so the check
 * is whether a glide drops frames or steps unevenly, not a cost ratio.
 */
const GLIDE_REBUILD_EVERY = 2;
let glide = createPresetGlide({
  ease: smoothstep,
  rebuildEvery: GLIDE_REBUILD_EVERY,
});
/** The glide's clock: real time, unless a test pins it (`pinGlideClock`). */
let pinnedGlideMs = null;
const glideNow = () => pinnedGlideMs ?? performance.now();
/**
 * The shadow configuration is HELD for a whole glide (round-3 plan §8
 * finding 6): on when either end casts, so crossing the 2° floor mid-glide
 * switches nothing and compiles no program; the floor applies again when
 * the glide settles or is cancelled.
 */
let glideHoldsShadows = false;
/**
 * The lowest sun a held shadow map is rendered from, degrees: just above
 * the horizon, which the rig refuses (applyShadows).
 */
const HELD_SHADOW_MIN_DEG = 0.1;
/**
 * The shadow maps during a glide: "follow" re-renders them with every sky
 * rebuild, "freeze" keeps them until the glide settles (the cost sweep's
 * alternative).
 */
let glideShadows = "follow";

const lookOfState = () => ({
  elevation: state.elevation,
  azimuth: state.azimuth,
  visibility: state.visibility,
  exposureEv: state.exposureEv,
  clouds: state.clouds,
});

/**
 * What the preset BUTTONS do: glide from the look the scene shows to the
 * preset's (a click mid-glide retargets from there). `api.setPreset` and
 * a link stay instant.
 */
function glideToPreset(id) {
  const preset = LOOK_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset ${id}`);
  // Re-clicking the glide's target would restart its 5 s; clicking the
  // preset already shown would glide nowhere (review finding 5).
  if (glide.active ? glide.id === id : state.preset === id) return;
  const to = presetLook(preset);
  glide.start({ from: lookOfState(), to, id, nowMs: glideNow() });
  glideHoldsShadows =
    sunShadow !== null || sunShadowActive(to.elevation, SHADOW_FLOOR_DEG);
  state.preset = id;
  syncControls();
}

/**
 * Stop a glide where it is (a manual change or a link takes over). The look
 * it leaves is no preset's, so the state says "custom" (review finding 1: a
 * link naming no preset kept the TARGET's name for a half-way sky);
 * `setPreset` and a link that names a preset overwrite it.
 */
function cancelGlide() {
  if (glide.active) state.preset = "custom";
  glide.cancel();
  glideHoldsShadows = false;
}

/**
 * One frame of the glide: apply the look on the frames the glide says to
 * rebuild; the settling frame applies the preset through `applyLook`, which
 * restores the floor's rule and writes the hash.
 */
function glideTick() {
  const step = glide.tick(glideNow());
  if (!step?.rebuild) return step;
  Object.assign(state, step.look);
  if (step.done) {
    glideHoldsShadows = false;
    applyLook();
  } else {
    useAtmosphere();
    syncControls();
  }
  return step;
}

// --- the look -----------------------------------------------------------------

let atmosphere = null;
let lutMs = 0;
/** The whole `useAtmosphere` (LUTs, readback, bake, light, shadows), ms. */
let atmosphereMs = 0;

function sunVector() {
  return sunDirection({
    elevationRad: state.elevation * DEG,
    azimuthRad: state.azimuth * DEG,
  });
}

function aimSunLight(direction) {
  sun.position.set(direction.x, direction.y, direction.z).multiplyScalar(1000);
}

function useAtmosphere() {
  if (!atmosphere) {
    atmosphere = new SkyAtmosphere({
      renderer,
      scene,
      visibilityKm: state.visibility,
      sunIntensity: SUN_INTENSITY,
    });
  }
  const start = performance.now();
  atmosphere.setExposureCompensation(state.exposureEv);
  const direction = sunVector();
  // One call, one rebuild: a preset moves the sun, the visibility and the
  // cloud cover together (M2 review, finding 13).
  atmosphere.configure({
    sunDirection: direction,
    visibilityKm: state.visibility,
    cloudCover: state.clouds,
    cloudMode: state.cloudMode,
    sunThroughClouds: {
      discExponent: state.sunDisc ? CLOUD_SUN.pageDiscExponent : 0,
      aureole: state.sunAureole ? 1 : 0,
      silverLining: state.sunSilver ? 1 : 0,
    },
  });
  lutMs = performance.now() - start;
  haze.sync(atmosphere);
  haze.setMode(state.haze ? "atmosphere" : "fog");
  cloudShadow.sync(atmosphere);
  cloudShadow.setEnabled(state.cloudShadows);
  atmosphere.applySunLight(sun);
  sunBaseIntensity = sun.intensity;
  aimSunLight(direction);
  applyShadows(direction);
  renderer.toneMapping = TONE_MAPPINGS[state.tone];
  renderer.toneMappingExposure = 1;
  // ONE fog, recoloured: a new fog object makes three re-derive every fogged
  // material's program on the next frame (a cache hit, but work on every
  // glide rebuild; review finding 6). Its near and far never change.
  const horizon = atmosphere.horizonColour();
  if (scene.fog?.isFog) scene.fog.color.copy(horizon);
  else
    scene.fog = new THREE.Fog(horizon, ATMOSPHERE_FOG_NEAR_M, ATMOSPHERE_FAR_M);
  camera.far = ATMOSPHERE_FAR_M;
  atmosphereMs = performance.now() - start;
}

/**
 * Sun shadows on or off. On: shadow maps on the renderer (once), every
 * building casts and receives, the ground and the streets receive, and the
 * sun light is driven by the framework's rig (a re-render only when the sun
 * moved; the page reports how many).
 */
function applyShadows(direction) {
  const elevationDeg = state.elevation;
  const on =
    state.shadows &&
    (glideHoldsShadows || sunShadowActive(elevationDeg, SHADOW_FLOOR_DEG));
  shadowsBelowFloor = state.shadows && !on;
  if (!on) {
    // dispose() restores the light as it was found when the shadow was
    // created (the sun of THEN): aim it at the current sun again.
    if (sunShadow) {
      sunShadow.dispose();
      sunShadow = null;
      aimSunLight(direction);
    }
    applyRingShadow(null);
    return;
  }
  if (!sunShadow) {
    enableSunShadows(renderer);
    for (const building of [...parts.city.children, ...parts.dense.children]) {
      building.castShadow = true;
      building.receiveShadow = true;
    }
    // EVERY STAND-IN OBJECT CASTS (W3 plan M1; the owner saw the spheres
    // cast nothing while only the city was listed).
    for (const part of CASTING_PARTS) {
      parts[part].traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
    }
    parts.ground.receiveShadow = true;
    parts.streets.traverse((o) => (o.receiveShadow = true));
    // The central map's camera stands BEYOND the whole dense city toward the
    // sun, not the rig's R + 30 m: a caster behind the camera is not in the
    // map, and receivers inside the central frustum read only this map, so
    // at a low sun every long shadow of the dense city (which starts at
    // 420 m) had a hole across the centre (round-2 plan §11, finding 1).
    // Depth over 2.7 km still resolves to well under a millimetre.
    sunShadow = createSunShadow({
      light: sun,
      mapSize: shadowParams.mapSize,
      distanceM: SUN_SHADOW_DISTANCE_M,
    });
  }
  sun.shadow.radius = shadowParams.radius;
  sun.shadow.bias = shadowParams.bias;
  if (shadowParams.everyFrame) sun.shadow.autoUpdate = true;
  // Frozen maps keep their pose until the glide settles; the light still
  // shades from the moving sun (aimSunLight above). Only maps that exist
  // freeze: a shadow switched on by the glide's hold renders once.
  const mapsExist =
    sunShadow.renders > 0 &&
    (ringShadow !== null || parts.dense.userData.count === 0);
  if (glide.active && glideShadows === "freeze" && mapsExist) return;
  // Held below the floor, the maps follow the TRUE sun down to
  // HELD_SHADOW_MIN_DEG, where the sun still lights the scene; below it they
  // render from a sun at that elevation (same azimuth), because the rig
  // refuses a sun at or below the horizon. There the setting disc's light
  // fades to 0, so the substitute shades next to nothing (review finding 3:
  // the first cut substituted the 2° floor, above a sun that still lit).
  const cast =
    elevationDeg >= HELD_SHADOW_MIN_DEG
      ? direction
      : sunDirection({
          elevationRad: HELD_SHADOW_MIN_DEG * DEG,
          azimuthRad: state.azimuth * DEG,
        });
  const length = Math.hypot(cast.x, cast.y, cast.z);
  const sunDir = [cast.x / length, cast.y / length, cast.z / length];
  sunShadow.update({
    sunDir,
    centre: [0, 0, 0],
    halfWidthM: shadowParams.halfWidthM,
    // The fill's count, pitch and meshes are part of the casters: a change
    // must re-render the map.
    casterGeneration: casterGeneration(),
    casterOffsetM: 0,
  });
  // The rig sets one texel of normal bias; the sweep scales it (set, not
  // multiplied: update() leaves it alone when it renders no map).
  sun.shadow.normalBias =
    ((2 * shadowParams.halfWidthM) / shadowParams.mapSize) *
    shadowParams.normalBiasTexels;
  applyRingShadow(sunDir);
}

/**
 * The ring shadow to the state: on while the sun casts (`sunDir` given) and
 * the dense city shows, off otherwise. The ring light is added AFTER the sun
 * under the same parent, so three makes it shadow 1 (ring-shadow.js).
 */
function applyRingShadow(sunDir) {
  const wanted = sunDir !== null && parts.dense.userData.count > 0;
  if (!wanted) {
    if (ringShadow) {
      ringShadow.shadow.dispose();
      ringShadow.light.target.removeFromParent();
      ringShadow.light.removeFromParent();
      ringShadow.light.dispose();
      ringShadow = null;
    }
    return;
  }
  if (!ringShadow) {
    const light = new THREE.DirectionalLight(0xffffff, 0);
    light.name = "ring-shadow";
    sun.parent.add(light, light.target);
    ringShadow = {
      light,
      shadow: createSunShadow({ light, mapSize: RING_MAP_SIZE }),
    };
  }
  ringShadow.shadow.update({
    sunDir,
    centre: [0, 0, 0],
    halfWidthM: RING_HALF_WIDTH_M,
    casterGeneration: casterGeneration(),
    casterOffsetM: 0,
  });
}

let composer = null;
let bloomPass = null;
/** The AO pass lives in the desktop composer, built on first use. */
const ambientOcclusion = createAmbientOcclusion({ GTAOPass, scene, camera });

/** Switch the cost tier: pixel ratio, and the bloom composer on or off. */
function applyTier() {
  const tier = TIERS[state.tier];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier.maxPixelRatio));
  if (tier.bloom && !composer) {
    // HALF FLOAT, as three's own composer: a radiance above 65 504 would
    // store as Inf, so the sky clamps its output (framework) and the firefly
    // clamp below turns any other Inf into 1024. A first cut used FULL FLOAT
    // where `EXT_color_buffer_float` exists; the M4 review found it pure
    // cost (~3× the memory, no measurable difference) and a risk: without
    // `OES_texture_float_linear` the linearly-filtered float texture
    // samples black.
    composer = new EffectComposer(
      renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
    );
    // MULTISAMPLED where the SCENE is drawn, and only there: RenderPass draws
    // into `readBuffer` (renderTarget2), and the two swapping passes below
    // (clamp, output) bring it back there every frame. Without MSAA the
    // "better" tier drew jagged silhouettes. It cannot match the canvas
    // exactly at edges: this resolves in HDR before tone mapping, the canvas
    // after (M4 review, finding 2).
    composer.renderTarget2.samples = 4;
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new ShaderPass(clampShader));
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      BLOOM.strength,
      BLOOM.radius,
      BLOOM.threshold,
    );
    composer.addPass(bloomPass);
    // Tone mapping and the output colour space move here: three applies
    // them only when drawing to the screen, and the passes draw to targets.
    composer.addPass(new OutputPass());
  } else if (!tier.bloom && composer) {
    // EffectComposer.dispose() frees only its own targets; the bloom pass
    // alone holds 11 render targets (M4 review, finding 4).
    for (const pass of composer.passes) pass.dispose?.();
    composer.dispose();
    composer = null;
    bloomPass = null;
  }
  ambientOcclusion.sync(composer, state.ao);
  // SIZE NOW, not on the next animation frame: a new composer's targets are
  // 1×1 until sized, and a readPixels straight after a tier switch rendered
  // through them (a first bloom measurement read a stretched 1×1 image).
  lastSize = "";
  resize();
}

/** The sun light's intensity from the sky, before the cloud dimming. */
let sunBaseIntensity = 1;
/** Where the "sun light dims" switch reads the clouds: the scene's centre. */
const SUN_DIM_POINT = [0, 0, 0];

/**
 * The sun light dimmed by the cloud column over the scene's centre, when
 * the switch is on (it follows the drift, so it is set every frame).
 */
function applySunLightDim() {
  const t =
    state.sunLightDim && atmosphere
      ? atmosphere.cloudTransmittanceToward(SUN_DIM_POINT)
      : 1;
  sun.intensity = sunBaseIntensity * t;
}

/** One frame, through the composer on the desktop tier. */
function renderFrame() {
  applySunLightDim();
  if (composer) composer.render();
  else renderer.render(scene, camera);
  catalogLabels?.render(scene, camera);
}

/** The catalog's spheres and labels, built while `state.catalog` is on. */
let catalogView = null;
let catalogLabels = null;
/**
 * The label rule the labels read every frame: a copy of LABEL_RULE, which
 * the round-3 K sweep changes through `setLabelRule`.
 */
const labelRule = { ...LABEL_RULE };

/**
 * The material catalog to the state (W5 M1): built on first use (hazed like
 * the world; its spheres cast), disposed when switched off.
 */
function applyCatalog() {
  if (state.catalog && !catalogView) {
    catalogView = buildCatalog(CATALOG);
    cloudShadow.applyToObject(catalogView.group);
    haze.applyToObject(catalogView.group);
    scene.add(catalogView.group);
    catalogLabels = createCatalogLabels(canvas, catalogView.group, labelRule);
    catalogLabels.setSize(canvas.clientWidth, canvas.clientHeight);
  } else if (!state.catalog && catalogView) {
    catalogLabels.dispose();
    catalogView.dispose();
    catalogLabels = null;
    catalogView = null;
  }
}

/** What the dense city's meshes depend on besides the pitch. */
const denseKey = () => (state.varied ? `varied ${state.materials}` : "plain");
/** The key the current dense city was built with (the stand-in's: plain). */
let builtDenseKey = "plain";
/** The shadow maps' caster generation: the fill's count, pitch and meshes. */
const casterGeneration = () =>
  `city ${state.city}@${state.pitch} ${builtDenseKey}`;

/**
 * The dense city to the state: a new pitch or material set rebuilds the
 * part (hazed, and flagged as casters when shadows are on); a count only
 * moves the prefixes, and the finish only sets each material's roughness
 * (a uniform: no rebuild, no new program).
 */
function applyCity() {
  if (
    parts.dense.userData.pitch !== state.pitch ||
    builtDenseKey !== denseKey()
  ) {
    const old = parts.dense;
    scene.remove(old);
    for (const mesh of old.children) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    const materials = state.varied
      ? pickCityMaterials(CITY_POOL, state.materials).map((entry) => {
          const material = catalogMaterial(entry);
          material.userData.catalogId = entry.id;
          return material;
        })
      : null;
    parts.dense = denseCity(state.pitch, { materials });
    builtDenseKey = denseKey();
    cloudShadow.applyToObject(parts.dense);
    haze.applyToObject(parts.dense);
    if (sunShadow) {
      for (const mesh of parts.dense.children) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    }
    scene.add(parts.dense);
  }
  const roughness = CITY_FINISHES[state.finish];
  for (const mesh of parts.dense.children) {
    mesh.material.userData.baseRoughness ??= mesh.material.roughness;
    mesh.material.roughness = roughness ?? mesh.material.userData.baseRoughness;
  }
  parts.dense.userData.setCount(state.city);
}

/**
 * The pond's wave set to the state: a new WaterSurface with the candidate's
 * slope (each gets its own program), hazed like the old one, keeping the
 * wave clock so the pond does not jump.
 */
function applyWater() {
  if (state.water === waterId) return;
  const candidate = WATER_CANDIDATES.find((c) => c.id === state.water);
  const next = new WaterSurface(
    candidate ? { slopeGlsl: candidate.slopeGlsl } : {},
  );
  next.update(water.uniforms.uWaterTime.value);
  cloudShadow.apply(next.material);
  haze.apply(next.material);
  parts.lake.material = next.material;
  water.dispose();
  water = next;
  waterId = state.water;
}

function applyLook() {
  applyCity();
  applyCatalog();
  applyWater();
  useAtmosphere();
  applyTier();
  camera.updateProjectionMatrix();
  // A glide writes the hash when it settles (round-3 plan §4 B); another
  // control used mid-glide does not write a half-way view.
  if (!glide.active) writeHash();
  syncControls();
}

/**
 * Two camera placements, because a sky judged only from its anti-sun side is
 * half judged: `city` is the demos' three-quarter view of the block, `sun`
 * stands in the street and looks along the sun's azimuth, just above the
 * horizon, where the glow, the disc and the haze all are.
 */
function placeCamera(view) {
  if (view === "sun" || view === "antisun") {
    const sign = view === "sun" ? 1 : -1;
    const toward = sunVector();
    const flat = (Math.hypot(toward.x, toward.z) || 1) * sign;
    camera.position.set(-20, 18, 60);
    controls.target.set(
      camera.position.x + (toward.x / flat) * 100,
      camera.position.y + 12,
      camera.position.z + (toward.z / flat) * 100,
    );
  } else if (view === "atsun") {
    // Straight at the sun from the street (round-3 stream D): the disc, its
    // glow and the clouds in front of it, at any elevation.
    const toward = sunVector();
    camera.position.set(-20, 18, 60);
    controls.target.set(
      camera.position.x + toward.x * 100,
      camera.position.y + toward.y * 100,
      camera.position.z + toward.z * 100,
    );
  } else if (view === "aloft") {
    // Just above the cloud sheet, looking slightly down at the deck. Not AT
    // its altitude: there it is edge-on and invisible (M1 review, finding 3).
    camera.position.set(-300, 2150, 600);
    controls.target.set(-300, 2100, -400);
  } else if (view === "inside") {
    // In the middle of the slab, level: a whiteout there, where the sheet
    // reads nothing (plan §11.7 E6). A fixed x/z (triage §12).
    camera.position.set(-300, 2000, 600);
    controls.target.set(-300, 2000, -400);
  } else if (view === "above") {
    // Above the sheet, looking down at the city; offset horizontally so the
    // look-at keeps an up vector (review finding 15).
    camera.position.set(-900, 3200, 1100);
    controls.target.set(40, 0, 0);
  } else if (view === "catalog") {
    // Close to the grid: the spheres 24-83 m away, all inside the labels'
    // 140 m fade, so the nearest-labels cap K decides which of the spheres
    // on screen show (W5 triage; round-3 plan 2026-09-27-0532).
    const [x0, y0, z0] = CATALOG_LAYOUT.origin;
    const cx = x0 + ((CATALOG_LAYOUT.perRow - 1) * CATALOG_LAYOUT.pitchM) / 2;
    camera.position.set(cx, y0 + 7, z0 + 50);
    controls.target.set(cx, y0 - 2, z0 + 12);
  } else if (view === "lake") {
    // Just above the floating pond's near edge, looking across it: water
    // is judged at grazing angles, where the sky it mirrors fills it.
    // 20 m up, like the old ground-level view (22 m over the shore): the
    // waves stay resolved, which a flatter view fades out (W1 M4).
    camera.position.set(POND.x - 70, FLOAT_HEIGHT_M + 20, POND.z + 100);
    controls.target.set(POND.x + 110, FLOAT_HEIGHT_M, POND.z - 110);
  } else {
    camera.position.set(-240, 55, 270);
    controls.target.set(40, 20, 0);
  }
  controls.update();
  // NOW, not at the next render: `project()` reads matrixWorldInverse, and
  // a stale one put a test's "ring around the sun" at the frame's edge
  // (M4 review, finding 1).
  camera.updateMatrixWorld();
}

// --- controls ------------------------------------------------------------------

const $ = (selector) => document.querySelector(selector);
const visibilityFromSlider = (v) => 5 * 60 ** v;
const sliderFromVisibility = (km) => Math.log(km / 5) / Math.log(60);

function syncControls() {
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.preset === state.preset),
    );
  }
  $("#elevation").value = state.elevation;
  $("#azimuth").value = state.azimuth;
  $("#visibility").value = sliderFromVisibility(state.visibility);
  $("#exposure").value = state.exposureEv;
  $("#clouds").value = state.clouds;
  $("#tone").value = state.tone;
  $("#haze").checked = state.haze;
  $("#shadows").checked = state.shadows;
  $("#tier").value = state.tier;
  $("#cloud-mode").value = state.cloudMode;
  $("#water-set").value = state.water;
  $("#catalog").checked = state.catalog;
  $("#ao").checked = state.ao;
  $("#sun-disc").checked = state.sunDisc;
  $("#sun-aureole").checked = state.sunAureole;
  $("#sun-silver").checked = state.sunSilver;
  $("#cloud-shadows").checked = state.cloudShadows;
  $("#sun-light-dim").checked = state.sunLightDim;
  // The switch works on either tier; on the phone tier it says it draws on
  // the desktop tier only and offers the switch (the owner looked for it).
  $("[data-ao-tier]").hidden = state.tier === "desktop";
  $("#varied").checked = state.varied;
  // A count the panel does not list (a link may name any count in the
  // pool's range) gets its own option, so the select never goes blank.
  const materialsSelect = $("#city-materials");
  const materialsValue = String(state.materials);
  if (![...materialsSelect.options].some((o) => o.value === materialsValue)) {
    materialsSelect.add(
      new Option(`City: ${materialsValue} catalog materials`, materialsValue),
    );
  }
  materialsSelect.value = materialsValue;
  $("#city-finish").value = state.finish;
  const cityValue = `${state.city}@${state.pitch}`;
  const citySelect = $("#city-fill");
  if ([...citySelect.options].some((o) => o.value === cityValue)) {
    citySelect.value = cityValue;
  }
  $("[data-values]").textContent =
    `sun ${state.elevation.toFixed(1)}° / ${state.azimuth.toFixed(0)}° · ` +
    `visibility ${state.visibility.toFixed(0)} km · ${state.exposureEv >= 0 ? "+" : ""}${state.exposureEv.toFixed(1)} EV` +
    (atmosphere ? ` (auto ×${atmosphere.exposure.toFixed(2)})` : "");
}

function buildControls() {
  const presets = $("[data-presets]");
  for (const preset of LOOK_PRESETS) {
    const button = document.createElement("button");
    button.className = "btn";
    button.dataset.preset = preset.id;
    button.textContent = preset.label;
    button.addEventListener("click", () => api.glideToPreset(preset.id));
    presets.append(button);
  }
  const onInput = (id, update) =>
    $(id).addEventListener("input", (e) => {
      cancelGlide();
      update(Number(e.target.value));
      state.preset = "custom";
      applyLook();
    });
  onInput("#elevation", (v) => (state.elevation = v));
  onInput("#azimuth", (v) => (state.azimuth = v));
  onInput("#visibility", (v) => (state.visibility = visibilityFromSlider(v)));
  onInput("#exposure", (v) => (state.exposureEv = v));
  onInput("#clouds", (v) => (state.clouds = v));
  $("#tone").addEventListener("change", (e) =>
    api.setToneMapping(e.target.value),
  );
  $("#haze").addEventListener("change", (e) => api.setHaze(e.target.checked));
  $("#shadows").addEventListener("change", (e) =>
    api.setShadows(e.target.checked),
  );
  $("#catalog").addEventListener("change", (e) =>
    api.setCatalog(e.target.checked),
  );
  $("#tier").addEventListener("change", (e) => api.setTier(e.target.value));
  $("#ao").addEventListener("change", (e) => api.setAo(e.target.checked));
  $("#sun-disc").addEventListener("change", (e) =>
    api.setSunThroughClouds({ disc: e.target.checked }),
  );
  $("#sun-aureole").addEventListener("change", (e) =>
    api.setSunThroughClouds({ aureole: e.target.checked }),
  );
  $("#sun-silver").addEventListener("change", (e) =>
    api.setSunThroughClouds({ silver: e.target.checked }),
  );
  $("#sun-light-dim").addEventListener("change", (e) =>
    api.setSunLightDim(e.target.checked),
  );
  $("#cloud-shadows").addEventListener("change", (e) =>
    api.setCloudShadows(e.target.checked),
  );
  $("#ao-desktop").addEventListener("click", () => api.setTier("desktop"));
  $("#cloud-mode").addEventListener("change", (e) =>
    api.setCloudMode(e.target.value),
  );
  $("#camera-view").addEventListener("change", (e) =>
    api.setView(e.target.value),
  );
  $("#water-set").addEventListener("change", (e) =>
    api.setWater(e.target.value),
  );
  $("#varied").addEventListener("change", (e) =>
    api.setVaried(e.target.checked),
  );
  $("#city-materials").addEventListener("change", (e) =>
    api.setVaried(state.varied, Number(e.target.value)),
  );
  $("#city-finish").addEventListener("change", (e) =>
    api.setCityFinish(e.target.value),
  );
  $("#city-fill").addEventListener("change", (e) => {
    const [count, pitch] = e.target.value.split("@").map(Number);
    api.setCity(count, pitch);
  });
}

// --- loop and test surface -----------------------------------------------------

/**
 * The cloud mesh of the current mode (the sheet or the slab): the test
 * hooks keep their sheet-era names so the M1 e2e reads unchanged.
 */
function cloudMesh() {
  const mesh =
    scene.getObjectByName("atmosphere-cloud-sheet") ??
    scene.getObjectByName("atmosphere-cloud-slab");
  if (!mesh) throw new Error("no cloud mesh (cloud mode is dome)");
  return mesh;
}

let frameMs = 0;
let gpuMs = null;
let last = performance.now();
let contextLost = false;
/** Test surface: the loop stops drawing between a test's own renders (a slab frame costs ~0.7 s on SwiftShader). */
let loopPaused = false;
let lastSize = "";
let gpuTimer = createGpuTimer(renderer.getContext());

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const size = `${width}x${height}@${renderer.getPixelRatio()}`;
  if (size !== lastSize) {
    lastSize = size;
    renderer.setSize(width, height, false);
    composer?.setPixelRatio(renderer.getPixelRatio());
    composer?.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    catalogLabels?.setSize(width, height);
  }
}

function frame(now) {
  // Clamped at 0 too: the first rAF timestamp can precede the
  // performance.now() `last` was initialised with (the water rejected it).
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  frameMs = frameMs * 0.9 + (now - last) * 0.1;
  if (cloudDrift) atmosphere?.advanceClouds(dt);
  water.update(dt);
  last = now;
  resize();
  // A paused loop leaves the glide to the test (`glideTick`), so its frame
  // count is the test's.
  if (!contextLost && !loopPaused) glideTick();
  if (!contextLost && (!loopPaused || !api.ready)) {
    gpuTimer.begin();
    renderFrame();
    gpuTimer.end();
    gpuMs = gpuTimer.poll();
    if (!api.ready && !api.error) api.ready = true;
  }
  const gpu = gpuTimer.supported
    ? `GPU ${gpuMs === null ? "…" : gpuMs.toFixed(2)} ms`
    : "GPU n/a";
  $("[data-stats]").textContent =
    `${state.tier} · AO ${ambientOcclusion.active ? "on" : !state.ao ? "off" : ambientOcclusion.unsupported ? "n/a on Oculus Browser" : "on (desktop tier only)"} · clouds ${state.cloudMode} · shadows ${sunShadow ? `on (${sunShadow.renders} maps, central ${shadowParams.halfWidthM} m${ringShadow ? `, ring ${RING_HALF_WIDTH_M} m` : ""})` : shadowsBelowFloor ? "on (sun below 2°)" : "off"} · ${cityReadout()} · ${frameMs.toFixed(1)} ms/frame · ${gpu} · ${renderer.info.render.calls} draws · ` +
    `${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · LUT ${lutMs.toFixed(1)} ms · sky ${atmosphereMs.toFixed(1)} ms` +
    (glide.active ? ` · glide to ${glide.id}` : "");
  requestAnimationFrame(frame);
}

/** The readout's city part: the material count and the A/B finish. */
function cityReadout() {
  const meshes = parts.dense.children.length;
  const kind = state.varied
    ? `${meshes} catalog materials`
    : "plain, 2 materials";
  const finish = state.finish === "mixed" ? "" : `, all ${state.finish}`;
  return `city ${kind}${finish}`;
}

canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  contextLost = true;
  api.ready = false;
});
// A link is a view after load too: a pasted link or the back button changes
// only the hash. writeHash uses replaceState, which fires no hashchange, so
// this cannot loop.
window.addEventListener("hashchange", () => {
  // A link opened mid-glide wins, at once (round-3 plan §8 finding 8).
  cancelGlide();
  readHash();
  applyLook();
});

canvas.addEventListener("webglcontextrestored", () => {
  contextLost = false;
  // Queries and the extension object died with the old context; pending
  // ones would never report and freeze the readout (M4 review, finding 9).
  gpuTimer = createGpuTimer(renderer.getContext());
  // SkyAtmosphere rebuilds its LUTs itself; the fog colour is re-derived.
  applyLook();
});

Object.assign(api, {
  setPreset(id) {
    const preset = LOOK_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`unknown preset ${id}`);
    // Instant, as before: tests and links rely on it; it stops a glide.
    cancelGlide();
    applyPresetToState(preset);
    applyLook();
  },
  /** What the preset buttons do: a 5 s glide (preset-glide.js). */
  glideToPreset(id) {
    glideToPreset(id);
  },
  /**
   * Test surface: pin the glide's clock at `ms` (null: real time again).
   * With the loop paused, `glideTick` then runs the glide's frames.
   */
  pinGlideClock(ms) {
    if (ms !== null && !Number.isFinite(ms)) {
      throw new RangeError(`the glide clock must be finite or null, got ${ms}`);
    }
    pinnedGlideMs = ms;
  },
  /** Test surface: one glide frame; the step, or null while idle. */
  glideTick: () => glideTick(),
  /** Test surface: the glide's state. */
  glideInfo: () => ({
    active: glide.active,
    id: glide.id,
    rebuildEvery: glide.rebuildEvery,
    holdsShadows: glideHoldsShadows,
    shadows: glideShadows,
  }),
  /**
   * The rate sweep's handle: the sky rebuilds on every k-th glide frame.
   * Only while no glide runs.
   */
  setGlideRebuildEvery(k) {
    if (glide.active) throw new Error("a glide is running");
    glide = createPresetGlide({ ease: smoothstep, rebuildEvery: k });
  },
  /** The cost sweep's handle: "follow" (the default) or "freeze". */
  setGlideShadows(mode) {
    if (!["follow", "freeze"].includes(mode)) {
      throw new Error(`unknown glide shadow mode ${mode}`);
    }
    glideShadows = mode;
  },
  /** Test surface: the ids of the programs three holds, ascending. */
  programIds: () =>
    (renderer.info.programs ?? []).map((p) => p.id).sort((a, b) => a - b),
  setToneMapping(name) {
    if (!(name in TONE_MAPPINGS))
      throw new Error(`unknown tone mapping ${name}`);
    state.tone = name;
    applyLook();
  },
  setCloudCover(cover) {
    cancelGlide();
    state.clouds = cover;
    applyLook();
  },
  setHaze(on) {
    state.haze = Boolean(on);
    applyLook();
  },
  setTier(name) {
    if (!(name in TIERS)) throw new Error(`unknown tier ${name}`);
    state.tier = name;
    applyLook();
  },
  /**
   * Test surface: switch ONLY the bloom pass (desktop tier). With it off, the
   * desktop pipeline must draw exactly the phone picture.
   */
  setBloom(on) {
    if (!bloomPass) throw new Error("bloom exists on the desktop tier only");
    bloomPass.enabled = Boolean(on);
  },
  /** Screen-space ambient occlusion on or off (drawn on the desktop tier). */
  setAo(on) {
    state.ao = Boolean(on);
    applyLook();
  },
  /**
   * The AO sweep's handle: `{ params, denoise }` merged into the pass (see
   * ambient-occlusion.js AO_PARAMS / AO_DENOISE). Returns the merged pair.
   */
  setAoParams(values) {
    return ambientOcclusion.configure(values);
  },
  /**
   * Test surface: the page's AO exclusions on or off (off is three's own
   * rule, which draws the sky and the clouds into the AO's depth), so a
   * test can show in the same run what they prevent.
   */
  setAoExclusions(on) {
    if (!ambientOcclusion.pass) throw new Error("the AO pass is not built");
    ambientOcclusion.pass.pageExclusions = Boolean(on);
  },
  /**
   * Test surface: the AO checks' world points (see ambient-occlusion.js.md).
   * `crease`: the ground 0.3 m in front of the city view's nearest
   * building's +z wall, mid-wall; `open`: ground 25 m out from its -x
   * wall (open at the AO's metre scale); `farCrease`: the block's
   * farthest crease the camera sees (the ground 0.3 m in front of a -x or
   * +z wall, mid-wall, clear of every block building on the line of sight),
   * with `farCreaseM` its distance; `far`: the ground 0.3 m in front of the
   * +z wall of the dense lot nearest a point `farM` (1500) out, 25° right
   * of the view's line of sight (clear of the block; null while the dense
   * city is off); `ridgeFoot`: where the first ridge (2.5 km) meets the
   * ground toward the sun, which the sun view looks at.
   */
  aoProbe({ farM = 1500 } = {}) {
    const near = parts.city.children.find(
      (b) => b.position.x === -126 && b.position.z === 126,
    );
    const nearFront = near.position.z + near.scale.z / 2;
    let far = null;
    const dense = parts.dense;
    if (dense.userData.count > 0) {
      const forward = new THREE.Vector3(
        controls.target.x - camera.position.x,
        0,
        controls.target.z - camera.position.z,
      ).normalize();
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const aim = camera.position
        .clone()
        .addScaledVector(forward, farM * Math.cos(25 * DEG))
        .addScaledVector(right, farM * Math.sin(25 * DEG));
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const [concrete] = dense.children;
      let best = Infinity;
      for (let k = 0; k < concrete.count; k++) {
        concrete.getMatrixAt(k, matrix);
        matrix.decompose(position, quaternion, scale);
        const d = Math.hypot(position.x - aim.x, position.z - aim.z);
        if (d < best) {
          best = d;
          far = [position.x, 0.06, position.z + scale.z / 2 + 0.3];
        }
      }
    }
    let farCrease = null;
    let farCreaseM = 0;
    const ray = new THREE.Raycaster();
    const toPoint = new THREE.Vector3();
    for (const b of parts.city.children) {
      const walls = [
        [b.position.x - b.scale.x / 2 - 0.3, b.position.z],
        [b.position.x, b.position.z + b.scale.z / 2 + 0.3],
      ];
      for (const [x, z] of walls) {
        const point = new THREE.Vector3(x, 0.06, z);
        const distance = point.distanceTo(camera.position);
        if (distance <= farCreaseM) continue;
        toPoint.copy(point).sub(camera.position).normalize();
        ray.set(camera.position, toPoint);
        ray.far = distance - 0.05;
        if (ray.intersectObjects(parts.city.children, false).length) continue;
        farCrease = [x, 0.06, z];
        farCreaseM = distance;
      }
    }
    const toSun = sunVector();
    const flat = Math.hypot(toSun.x, toSun.z) || 1;
    return {
      farCrease,
      farCreaseM,
      crease: [near.position.x, 0.06, nearFront + 0.3],
      open: [near.position.x - near.scale.x / 2 - 25, 0.06, near.position.z],
      far,
      ridgeFoot: [(toSun.x / flat) * 2499, 0.06, (toSun.z / flat) * 2499],
    };
  },
  /**
   * Test surface: multisampling of the composer's scene target on or off
   * (desktop tier). The target is re-allocated on the next render.
   */
  setSceneMsaa(on) {
    if (!composer)
      throw new Error("the composer exists on the desktop tier only");
    composer.renderTarget2.samples = on ? 4 : 0;
    composer.renderTarget2.dispose();
  },
  /**
   * Render one frame and return the whole drawing buffer (RGBA bytes,
   * bottom row first), for comparisons that need every pixel (edges).
   */
  readFrame() {
    renderFrame();
    const gl = renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const data = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { width, height, data };
  },
  /** Normalised canvas point [u, v] (0,0 = top-left) of a world point. */
  project([x, y, z]) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    return [(p.x + 1) / 2, (1 - p.y) / 2];
  },
  /** Advance the water's waves (tests step time deterministically). */
  advanceWater(seconds) {
    water.update(seconds);
  },
  setView(view) {
    if (!VIEWS.includes(view)) throw new Error(`unknown view ${view}`);
    placeCamera(view);
    $("#camera-view").value = view;
  },
  /** Sun shadows on or off (AR sun shadow plan M2). */
  setShadows(on) {
    state.shadows = Boolean(on);
    applyLook();
  },
  /**
   * The dense city (W1 M3): the nearest `count` lots of a `pitch` grid
   * (one of DENSE_PITCHES); 0 is the block alone.
   */
  setCity(count, pitch = state.pitch) {
    if (!DENSE_PITCHES.includes(pitch)) {
      throw new Error(`unknown pitch ${pitch}; one of ${DENSE_PITCHES}`);
    }
    state.city = Math.max(0, Math.floor(Number(count) || 0));
    state.pitch = pitch;
    applyLook();
  },
  /**
   * Test surface: which parts cast (every mesh in them; the catalog false
   * while it is off), and whether the catalog's spheres receive.
   */
  casterFlags() {
    const all = (part, key) => {
      let every = true;
      let any = false;
      const object = part === "catalog" ? catalogView?.group : parts[part];
      object?.traverse((o) => {
        if (!o.isMesh) return;
        any = true;
        every = every && o[key];
      });
      return any && every;
    };
    return {
      casts: {
        city: all("city", "castShadow"),
        dense: all("dense", "castShadow"),
        catalog: all("catalog", "castShadow"),
        markers: all("markers", "castShadow"),
        families: all("families", "castShadow"),
      },
      catalogReceives: all("catalog", "receiveShadow"),
    };
  },
  /**
   * Test surface: the floating pond, its basin and the catalog (when built)
   * on or off. They float at 105 m, so from the city view they stand
   * against the sky; a test that samples SKY pixels hides them (W1 M4).
   */
  setFloatingVisible(on) {
    for (const part of ["lake", "basin"]) {
      parts[part].visible = Boolean(on);
    }
    if (catalogView) catalogView.group.visible = Boolean(on);
  },
  /**
   * Test surface: where the pond and the catalog's spheres float (W1 M4;
   * `catalogMinY` is Infinity while the catalog is off).
   */
  floating() {
    let catalogMinY = Infinity;
    catalogView?.group.traverse((o) => {
      if (o.isMesh) catalogMinY = Math.min(catalogMinY, o.position.y);
    });
    const p = parts.lake.position;
    return {
      lake: { x: p.x, y: p.y, z: p.z, rx: POND.rx, rz: POND.rz },
      catalogMinY,
    };
  },
  /** Test surface: `n` points on the pond's surface, well inside its rim. */
  lakeSurfacePoints(n) {
    const p = parts.lake.position;
    const columns = 4;
    const rows = Math.ceil(n / columns);
    const out = [];
    for (let k = 0; k < n; k++) {
      const u = (k % columns) / (columns - 1) - 0.5; // -0.5..0.5
      const v = rows > 1 ? Math.floor(k / columns) / (rows - 1) - 0.5 : 0;
      out.push([p.x + u * POND.rx, p.y, p.z + v * 0.8 * POND.rz]);
    }
    return out;
  },
  /** The pond's wave set: "C0" (today's) or a candidate id (W6). */
  setWater(id) {
    if (!WATER_IDS.includes(id)) {
      throw new Error(`unknown water set ${id}; one of ${WATER_IDS}`);
    }
    state.water = id;
    applyLook();
  },
  /** Test surface: the wave-set ids, today's first. */
  waterCandidates() {
    return [...WATER_IDS];
  },
  /**
   * The dense city's varied materials (DEC-FB3-3): on or off, and how many
   * catalog materials (1..the pool's size; the cost sweep uses 4, 8, 12).
   */
  setVaried(on, count = state.materials) {
    if (!isMaterialCount(count)) {
      throw new RangeError(
        `the material count must be an integer in 1..${CITY_POOL.length}, got ${count}`,
      );
    }
    state.varied = Boolean(on);
    state.materials = count;
    applyLook();
  },
  /**
   * The owner's A/B (DEC-FB3-3): "mixed" (each material's own roughness),
   * "shiny" (every city material at roughness 0) or "matte" (1).
   */
  setCityFinish(finish) {
    if (!Object.hasOwn(CITY_FINISHES, finish)) {
      throw new Error(
        `unknown finish ${finish}; one of ${Object.keys(CITY_FINISHES)}`,
      );
    }
    state.finish = finish;
    applyLook();
  },
  /** Test surface: the dense city as it stands. */
  cityInfo() {
    const dense = parts.dense;
    const meshes = dense.children;
    return {
      count: dense.userData.count,
      max: dense.userData.max,
      pitch: dense.userData.pitch,
      farthest: dense.userData.farthest,
      casts: meshes.every((m) => m.castShadow),
      receives: meshes.every((m) => m.receiveShadow),
      varied: state.varied,
      finish: state.finish,
      meshes: meshes.length,
      materials: meshes.map((m) => m.material.userData.catalogId ?? m.name),
      instances: meshes.reduce((total, m) => total + m.count, 0),
      roughness: meshes.map((m) => m.material.roughness),
    };
  },
  /**
   * Test surface, the cost measurement's handle: one warm-up frame (a
   * pending shadow map or a program compile lands there), then `n` timed
   * frames, each finished by a 1-pixel read so the GPU work is inside the
   * time. `shadowMaps` re-renders both sun shadow maps in every timed frame
   * (the frame after a sun move); `warmup: false` skips the warm-up, to time
   * the frame right after a change. Returns the median ms (with an even
   * `n`, the upper middle: with 2 it is the max; use an odd `n`), the last
   * frame's draws and triangles (shadow passes included) and the program
   * count. SwiftShader times are relative only.
   */
  timeFrames(n, { shadowMaps = false, warmup = true } = {}) {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const frameOnce = () => {
      renderFrame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    if (warmup) frameOnce();
    const times = [];
    for (let i = 0; i < n; i++) {
      if (shadowMaps) {
        if (sunShadow) sun.shadow.needsUpdate = true;
        if (ringShadow) ringShadow.light.shadow.needsUpdate = true;
      }
      const start = performance.now();
      frameOnce();
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return {
      medianMs: times[Math.floor(times.length / 2)],
      draws: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      programs: renderer.info.programs?.length ?? 0,
    };
  },
  /** Test surface: render one frame and return its draw calls. */
  drawCalls() {
    renderFrame();
    return renderer.info.render.calls;
  },
  /**
   * The cost sweep's handle: any of { halfWidthM, mapSize, radius,
   * normalBiasTexels, bias, everyFrame } (everyFrame re-renders the map every
   * frame, to time one map render on a real GPU). Rebuilds the shadow.
   */
  setShadowParams(params) {
    Object.assign(shadowParams, params);
    sunShadow?.dispose();
    sunShadow = null;
    applyLook();
  },
  /** Test surface: the light's manual-map flags (autoUpdate, needsUpdate). */
  shadowFlags: () => ({
    autoUpdate: sun.shadow.autoUpdate,
    needsUpdate: sun.shadow.needsUpdate,
  }),
  /** Test surface: how many shadow maps the rig asked for (null when off). */
  shadowRenders: () => (sunShadow ? sunShadow.renders : null),
  /**
   * Test surface: the unit direction the central shadow map is rendered
   * from (the rig puts the light at the centre plus that direction times its
   * distance, and the centre is the origin); null while shadows are off.
   */
  shadowLightDirection() {
    if (!sunShadow) return null;
    const d = sun.position.clone().normalize();
    return [d.x, d.y, d.z];
  },
  /** Test surface: the scene's fog (one object, recoloured per rebuild). */
  fog: () => scene.fog,
  /**
   * Test surface: a ground point in the tallest building's cast shadow (2 m
   * past its footprint, away from the sun), and a DIFFUSE sunlit control:
   * ground 205 m from the centre toward the sun, past every building (they
   * reach ~200 m on the diagonal) and inside the 220 m map, which nothing
   * shades. (The tallest building's roof was the first control: it is the
   * glass tower, mostly reflected sky, blind to shadows; M2 review.)
   */
  shadowProbe() {
    let tallest = null;
    for (const b of parts.city.children) {
      if (!tallest || b.scale.y > tallest.scale.y) tallest = b;
    }
    const d = sunVector();
    const flat = Math.hypot(d.x, d.z) || 1;
    const away = [-d.x / flat, -d.z / flat];
    // The footprint's reach along the away direction (an axis-aligned box).
    const reach =
      Math.abs(away[0]) * (tallest.scale.x / 2) +
      Math.abs(away[1]) * (tallest.scale.z / 2);
    const p = tallest.position;
    return {
      shadowed: [
        p.x + away[0] * (reach + 2),
        0.05,
        p.z + away[1] * (reach + 2),
      ],
      // The shadow's FOOT, 0.3 m past the footprint: where a coarse map's
      // texels and normal bias weaken it (round-2 plan M2, review finding 2).
      foot: [
        p.x + away[0] * (reach + 0.3),
        0.05,
        p.z + away[1] * (reach + 0.3),
      ],
      // Sunlit only with the block alone: at a low sun the dense city's long
      // shadows reach it (the smoke boots with city=0 unless it names one).
      lit: [-away[0] * 205, 0.05, -away[1] * 205],
      // The lee of the Lambert box (a caster that stands on the ground),
      // just past its footprint away from the sun (W3 plan M1).
      family: (() => {
        const box = parts.families.children.find((o) => o.isMesh);
        box.geometry.computeBoundingBox();
        const size = box.geometry.boundingBox.getSize(new THREE.Vector3());
        const along =
          Math.abs(away[0]) * (size.x / 2) + Math.abs(away[1]) * (size.z / 2);
        return [
          box.position.x + away[0] * (along + 2),
          0.05,
          box.position.z + away[1] * (along + 2),
        ];
      })(),
      // An acne detector: the roof of the tallest DIFFUSE (non-glass)
      // building, a caster that receives; a bad bias shadows it itself.
      roof: (() => {
        let best = null;
        for (const b of parts.city.children) {
          if (b.material.metalness >= 0.5) continue;
          if (!best || b.scale.y > best.scale.y) best = b;
        }
        return [best.position.x, best.scale.y, best.position.z];
      })(),
    };
  },
  /** The material catalog on or off (W5 M1; on by default since round 3). */
  setCatalog(on) {
    state.catalog = Boolean(on);
    applyLook();
  },
  /**
   * Compile every material in the scene, drawn or not (three otherwise
   * compiles a program only when its object is first drawn, so a check of
   * "every entry compiles" would depend on the camera). Returns the program
   * count.
   */
  compileScene() {
    renderer.compile(scene, camera);
    return renderer.info.programs?.length ?? 0;
  },
  /** The catalog's entries, built spheres, shown labels and programs. */
  catalogInfo() {
    const labelIds = catalogLabels ? catalogLabels.visibleIds() : [];
    return {
      entries: CATALOG.length,
      spheres: catalogView ? catalogView.group.children.length : 0,
      visibleLabels: labelIds.length,
      labelIds,
      programs: renderer.info.programs?.length ?? 0,
    };
  },
  /**
   * Test surface: the sphere meshes in the scene, in the catalog's group and
   * outside it (the old white and gold swatches were a second set).
   */
  sphereMeshes() {
    const out = { catalog: 0, outside: 0 };
    scene.traverse((o) => {
      if (!o.isMesh || o.geometry?.type !== "SphereGeometry") return;
      let inCatalog = false;
      for (let p = o.parent; p; p = p.parent) {
        if (p === catalogView?.group) inCatalog = true;
      }
      out[inCatalog ? "catalog" : "outside"] += 1;
    });
    return out;
  },
  /** Test surface: the catalog's spheres (id and position), [] when off. */
  catalogSpheres() {
    if (!catalogView) return [];
    return catalogView.group.children.map((mesh) => ({
      id: mesh.name,
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
      // Where its label is anchored, world space (catalog-view.js).
      label: [
        mesh.position.x,
        mesh.position.y + CATALOG_LAYOUT.radiusM * 1.4,
        mesh.position.z,
      ],
    }));
  },
  /**
   * Test surface: change the label rule (any of { k, fadeNearM, fadeFarM });
   * the next frame reads it. The round-3 K sweep's handle.
   */
  setLabelRule(rule) {
    const next = { ...labelRule, ...rule };
    labelOpacities([], next); // throws RangeError for a bad rule
    Object.assign(labelRule, next);
  },
  /**
   * The sun through clouds (DEC-FB3-6), one switch per effect: `disc` (the
   * disc dims behind a cloud), `aureole` (thin cloud glows around the
   * sun), `silver` (thin backlit edges brighten); a key not given keeps
   * its value.
   */
  setSunThroughClouds({
    disc = state.sunDisc,
    aureole = state.sunAureole,
    silver = state.sunSilver,
  } = {}) {
    state.sunDisc = Boolean(disc);
    state.sunAureole = Boolean(aureole);
    state.sunSilver = Boolean(silver);
    applyLook();
  },
  /** The sun light dimmed by the clouds over the scene's centre, on or off. */
  setSunLightDim(on) {
    state.sunLightDim = Boolean(on);
    applyLook();
  },
  /**
   * Test surface: the sun light's intensity now, and the cloud column's
   * transmittance over the scene's centre that the dimming would apply.
   */
  sunLightDimInfo() {
    applySunLightDim();
    return {
      intensity: sun.intensity,
      base: sunBaseIntensity,
      transmittance: atmosphere
        ? atmosphere.cloudTransmittanceToward(SUN_DIM_POINT)
        : 1,
    };
  },
  /**
   * Test surface, the sweep's handle: the framework's raw values (any
   * disc exponent k and the two lobes' strengths), until the next look change.
   */
  setSunThroughCloudsRaw(values) {
    if (!atmosphere) throw new Error("the sun through clouds needs the sky");
    atmosphere.configure({ sunThroughClouds: values });
  },
  /**
   * Test surface: where the clouds stand in front of the sun, from the CPU
   * twins (sun-clouds.js): the column's optical depth along the sun from
   * the camera, how much of it is drawn there, and the sun's screen point.
   */
  sunCloud() {
    if (!atmosphere) throw new Error("the sun through clouds needs the sky");
    return sunCloudProbe.atSun(atmosphere, camera.position, sunVector());
  },
  /** Cloud shadows on the ground (DEC-FB3-7) on or off. */
  setCloudShadows(on) {
    state.cloudShadows = Boolean(on);
    applyLook();
  },
  /**
   * Test surface: the share of the sun reaching a world point through the
   * clouds, from the CPU twin (sun-clouds.js), for the current clouds.
   */
  cloudShadowAt(point) {
    if (!atmosphere) throw new Error("the cloud shadows need the sky");
    return sunCloudProbe.shadowAt(atmosphere, point, sunVector());
  },
  /**
   * Test surface: the ground (or a street) under normalised canvas points
   * [u, v], as world points, or null where something else is hit first.
   */
  groundAt(points) {
    const ray = new THREE.Raycaster();
    const receivers = new Set([parts.ground]);
    parts.streets.traverse((o) => receivers.add(o));
    return points.map(([u, v]) => {
      ray.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), camera);
      const [hit] = ray
        .intersectObjects(scene.children, true)
        .filter(
          (h) => h.object.visible && !h.object.name.startsWith("atmosphere-"),
        );
      return hit && receivers.has(hit.object) ? hit.point.toArray() : null;
    });
  },
  /** Dome (the sky's own layer), the fly-through sheet, or the slab. */
  setCloudMode(mode) {
    if (!CLOUD_MODES.includes(mode))
      throw new Error(`unknown cloud mode ${mode}`);
    state.cloudMode = mode;
    applyLook();
  },
  /**
   * Test surface: pin the clouds' drift offset (tiles) and stop the drift,
   * so pixel tests read the same sky every time.
   */
  setCloudOffset(u, v) {
    if (!atmosphere) throw new Error("the clouds need the atmosphere");
    cloudDrift = false;
    atmosphere.sky.material.uniforms.atmCloudOffset.value.set(u, v);
  },
  /**
   * Test surface: switch the sheet's depth test, so the occlusion test can
   * prove in the same run that it would fail without it.
   */
  setCloudSheetDepthTest(on) {
    cloudMesh().material.depthTest = Boolean(on);
  },
  /** Test surface: hide the sheet mesh (proves the dome draws no clouds). */
  setCloudSheetVisible(on) {
    cloudMesh().visible = Boolean(on);
  },
  /**
   * Test surface: the highest point of the scene's own content (the sky and
   * the cloud sheet excluded), metres: the sheet's occlusion rests on it
   * staying below the sheet.
   */
  sceneTopM() {
    const box = new THREE.Box3();
    for (const child of scene.children) {
      if (child.name.startsWith("atmosphere-") || !child.visible) continue;
      box.expandByObject(child);
    }
    return box.max.y;
  },
  /**
   * Test surface: stop (or restart) the render loop's own frames; the
   * test's `readPixels` still render. The slab's tests pause it, so a slow
   * frame renders only when a test reads one.
   */
  pauseLoop(on) {
    loopPaused = Boolean(on);
  },
  /**
   * Test surface: the step count the slab's material is BUILT with (its
   * define), so a test can tell a count that never reached the program.
   */
  cloudSlabDefine() {
    return cloudMesh().material.defines?.ATM_SLAB_STEPS ?? null;
  },
  /** Test surface: the unit direction toward the sun (x east, y up, -z north). */
  sunDirection() {
    const d = sunVector();
    return [d.x, d.y, d.z];
  },
  /** Test surface: an exact camera, for the crossing test. */
  placeCameraAt([x, y, z], [tx, ty, tz]) {
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
    controls.update();
    camera.updateMatrixWorld();
  },
  /**
   * Render one frame and read RGBA bytes at normalised canvas points
   * (0,0 = top-left). Read in the same task as the render, so the drawing
   * buffer is still valid without `preserveDrawingBuffer`.
   */
  readPixels(points) {
    renderFrame();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    return points.map(([u, v]) => {
      const px = new Uint8Array(4);
      const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      const y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2], px[3]];
    });
  },
  stats: () => ({
    frameMs,
    gpuMs,
    gpuTimer: gpuTimer.supported,
    aoActive: ambientOcclusion.active,
    sunThroughClouds: atmosphere?.sunThroughClouds ?? null,
    lutMs,
    atmosphereMs,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    state: { ...state },
  }),
  /**
   * GPU vs CPU for one on-screen SKY pixel at normalised point [u, v],
   * rendered with tone mapping off: 8-bit sRGB from the canvas and from the
   * CPU model along the same view direction.
   */
  skyPixelParity([u, v]) {
    if (!atmosphere) throw new Error("sky pixel parity needs the atmosphere");
    // Clouds off: the CPU model has no clouds, and this checks the sky itself.
    const previous = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    atmosphere.setClouds({ cover: 0 });
    const [px] = api.readPixels([[u, v]]);
    atmosphere.setClouds({ cover: state.clouds });
    renderer.toneMapping = previous;
    const direction = new THREE.Vector3(u * 2 - 1, 1 - v * 2, 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    return {
      gpu: px.slice(0, 3),
      cpu: skyPixelExpected(atmosphere, {
        direction,
        sunDirection: sunVector(),
      }),
    };
  },
  parity() {
    if (!atmosphere)
      throw new Error("parity needs the atmosphere (page not ready)");
    return lutParity(atmosphere, { sunCosZenith: sunVector().y });
  },
  /**
   * The CPU fallback sky (for devices without float targets) against the GPU
   * path it stands in for, at the current preset: exposure and the
   * exposure-free horizon colour from each.
   */
  fallbackParity() {
    if (!atmosphere)
      throw new Error("fallback parity needs the atmosphere (page not ready)");
    const cpu = fallbackSky(sunVector(), {
      visibilityKm: state.visibility,
      sunIntensity: SUN_INTENSITY,
      exposureCompensationEv: state.exposureEv,
    });
    const gpuHorizon = atmosphere.horizonColour();
    const gpu = atmosphere.exposure;
    return {
      gpuExposure: gpu,
      cpuExposure: cpu.exposure,
      gpuHorizon: [gpuHorizon.r / gpu, gpuHorizon.g / gpu, gpuHorizon.b / gpu],
      cpuHorizon: cpu.horizon.map((c) => c / cpu.exposure),
    };
  },
});

try {
  readHash();
  buildControls();
  applyLook();
  requestAnimationFrame(frame);
} catch (error) {
  fail(
    error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  );
  throw error;
}
