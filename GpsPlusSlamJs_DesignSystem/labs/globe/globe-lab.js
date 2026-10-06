/**
 * The globe lab (globe plan 2026-09-26-0539 §7, M0-M4): the globe package's
 * surface, served no-build through the design system's routes, textured and
 * credited (M1). It spins while it waits for a target, turns to it and
 * holds it at the centre, north up (M2). It is lit by the real sun of now or
 * of `#time=`, with night lights, a water glint and clouds (M3). Every
 * parameter sits on a control plate and in the hash, so a link reproduces a
 * view (M4). Round 2 (plan 2026-09-26-2055 M3): the lab owns a pinnable
 * clock, the clouds drift with it, and a background pass draws the sun's
 * disc, PROCEDURAL stars (not a catalogue: round-2 Q2) and a faint Milky
 * Way behind the Earth, turned with sidereal time.
 *
 * @see globe-lab.js.md
 */
import * as THREE from "three";
import { GlobeControls, WGS84_ELLIPSOID } from "3d-tiles-renderer";

import {
  GLOBE_SURFACE,
  createGlobeImagery,
  createGlobeSurface,
} from "/globe/globe-surface.js";
import { CLOUD_VOLUME } from "/globe/globe-cloud-volume.js";
import { creditsFor } from "/globe/globe-credits.js";
import { GIBS_ACKNOWLEDGEMENT } from "/globe/globe-sources.js";
import {
  GLOBE_FALLBACK_TARGET,
  chooseGlobeTarget,
  parseLatLngText,
} from "/globe/globe-target.js";
import {
  applyOrbitPose,
  clipPlanes,
  reliefClearanceM,
  orbitDistanceToFit,
  orbitPose,
  smoothstep,
} from "/globe/globe-camera.js";
import { sunDirectionEcef } from "/globe/globe-sun.js";
import { GLOBE_SKY, createGlobeSky } from "/globe/globe-sky.js";
import { GLOBE_STARS, greenwichSiderealAngleRad } from "/globe/globe-stars.js";
import {
  GLOBE_CLOUD_DRIFT_DEG_PER_S,
  GLOBE_SURFACE_TUNING,
  cloudLonOffsetRad,
} from "/globe/globe-surface-material.js";
import {
  readGlobeClockSetting,
  sameGlobeClockSetting,
  startGlobeClock,
} from "/globe/globe-clock.js";
import {
  GLOBE_DIVE,
  diveStep,
  obliqueCamera,
  planDive,
} from "/globe/globe-dive.js";
import { FLIGHT_PACE_DEFAULTS } from "/globe/flight-pace.js";
import { arrivalStatusText, createDiveClock } from "/globe/globe-arrival.js";
import { globePinView, nextPinPhase } from "/globe/globe-pin.js";
import { globeReadoutText, readoutThrottle } from "/globe/globe-readout.js";
import { handOverUrl } from "/globe/globe-handover.js";
import {
  GLOBE_INTRO,
  INTRO_VARIANTS,
  blendTarget,
  flyInStart,
  introCameraPose,
  spinDirection,
} from "/globe/globe-intro.js";
import {
  globeZoomOutLimitM,
  limitGlobeZoomOut,
} from "/globe/globe-zoom-limit.js";
import { GLOBE_TERRAIN, createGlobeTerrain } from "/globe/globe-terrain.js";
import { nextDrawnShare, topLevelReady } from "/globe/globe-band-gate.js";
import { asStencilFill, asStencilWriter } from "/globe/globe-stencil-fill.js";
import {
  applyEcefPose,
  ecefPoseOf,
  frameRecentreTarget,
  worldFromEcefAt,
} from "/globe/globe-frame.js";
import { drainTileCache, releaseTileCache } from "/globe/globe-tile-cache.js";
import { SKY_FILL } from "/globe/sky-level.js";
import {
  GLOBE_FLIGHT,
  carrierShareAt,
  clearedAltitudeM,
  exaggerationAt,
  minimumAltitudeM,
  pitchAtDeg,
} from "/globe/globe-flight.js";
import { GLOBE_ALBEDO } from "../terrain/terrain-globe-colour.js";
import {
  SYNTHETIC_HEIGHTS_URL,
  installSyntheticHeights,
} from "../globe-terrain/synthetic-heights.js";
import { geolocationPermissionState } from "/fw/sensors/permission-state.js";
import { createGlobeAtmosphere } from "./globe-atmosphere.js";
import {
  GLOBE_ATMOSPHERE,
  atmosphereCostText,
  defaultAtmosphereSteps,
  observerAltitudeKm,
} from "./globe-atmosphere-frame.js";
import { createGlobeGroundSky } from "./globe-ground-sky.js";
import { createGlobeHaze } from "./globe-haze.js";
import { createGlobeCloudVolume } from "./globe-cloud-volume.js";
import { EARTH_ATMOSPHERE } from "/fw/visualization/atmosphere/atmosphere-model.js";
import {
  GLOBE_SKY_HAND_OVER,
  shellThicknessAt,
} from "/globe/globe-sky-hand-over.js";
import {
  apparentSolarTimeHours,
  solarDateAt,
  solarPosition,
} from "/fw/geo/solar-position.js";
import { labelFor, locateAdvice, locateOnce } from "/fw/utils/locate-state.js";
import { createGlobeDebug } from "./globe-debug.js";
import { createDebugLog } from "./globe-debug-log.js";
import { deviceBlock } from "./globe-device.js";

const canvas = document.getElementById("globe-canvas");
const errorBox = document.getElementById("globe-error");
/**
 * The page's event log for the Debug panel (round-6 plan 2026-10-04-1050
 * G6-0): from the first line, so errors at boot are in it too.
 */
const debugLog = createDebugLog();
window.addEventListener("error", (e) =>
  debugLog.log("error", { message: String(e.message).slice(0, 300) }),
);
window.addEventListener("unhandledrejection", (e) =>
  debugLog.log("error", { message: String(e.reason).slice(0, 300) }),
);
{
  // three reports shader compile and link errors through console.error.
  const consoleError = console.error.bind(console);
  console.error = (...args) => {
    debugLog.log("console.error", {
      message: args.map(String).join(" ").slice(0, 300),
    });
    consoleError(...args);
  };
}
const creditsBox = document.getElementById("globe-credits");
const loadingLabel = document.getElementById("globe-loading");
const replayButton = document.getElementById("globe-replay");
const pinButton = document.getElementById("globe-pin");
const pinStatus = document.getElementById("globe-pin-status");
const arrivalStatus = document.getElementById("globe-arrival-status");
const deviceLine = document.getElementById("globe-device");
const readoutLine = document.getElementById("globe-readout");
const costButton = document.querySelector("[data-atmo-cost]");

/**
 * The device line (round-3 plan 2026-09-27-0532 §4 F; terrain plan
 * 2026-09-27-0605 §7): whether this device can filter float textures
 * linearly (`OES_texture_float_linear`), which the terrain dive needs, so
 * the owner can read it on his phone before that work starts. Asked once,
 * of the renderer's own context.
 */
function reportDevice(renderer) {
  const floatLinear = renderer.extensions.has("OES_texture_float_linear");
  const line = floatLinear
    ? "This device filters float textures (OES_texture_float_linear): yes"
    : "This device filters float textures (OES_texture_float_linear): NO";
  deviceLine.textContent = line;
  return {
    floatLinear,
    /** The device line with the atmosphere's measured cost after it. */
    showCost(text) {
      deviceLine.textContent = `${line}. ${text}`;
    },
  };
}

/**
 * The async-feedback rule (globe plan §7.8, M1): a label while imagery tiles
 * are pending, and a line in the error box when some could not load (the
 * parent level then shows there, DEC-PRG-14). DOM writes only on a change.
 */
function statusView() {
  let shown = false;
  let lastLoading = "";
  let lastError = "";
  return {
    get loadingShown() {
      return shown;
    },
    update({
      pendingTiles,
      loadedTiles,
      tileErrors,
      mapsLoaded,
      mapErrors,
      mapsTotal,
    }) {
      // The tiles and the two global maps (the clouds are the largest
      // single file): "loaded" only once all of them have arrived or failed.
      const mapsPending = mapsTotal - mapsLoaded - mapErrors;
      const loading =
        pendingTiles > 0 || mapsPending > 0
          ? `Loading Earth imagery: ${loadedTiles + mapsLoaded} of ${loadedTiles + pendingTiles + mapsLoaded + mapsPending}`
          : "";
      if (loading !== lastLoading) {
        lastLoading = loading;
        loadingLabel.textContent = loading;
        loadingLabel.hidden = loading === "";
        shown ||= loading !== "";
      }
      const error = [
        tileErrors > 0
          ? `Some Earth imagery could not load (${tileErrors} tiles): a coarser level shows there.`
          : "",
        mapErrors > 0
          ? `${mapErrors} of the night-light and cloud maps could not load.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (error !== lastError) {
        lastError = error;
        errorBox.textContent = error;
      }
    },
  };
}

/**
 * The credits line (globe plan §7.7): the short names over the canvas, the
 * full texts, links and GIBS's acknowledgement in a <details>. Built with
 * textContent only: the texts come from the registry, never from markup.
 */
function renderCredits(credits, heightsCredit = null) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Imagery: ${credits.map((c) => c.short).join(" · ")}. ${PROCEDURAL_STARS}${heightsCredit ? ` ${heightsCredit}` : ""}`;
  details.append(summary);
  const list = document.createElement("ul");
  for (const c of credits) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = c.href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = c.full;
    item.append(link);
    list.append(item);
  }
  const note = document.createElement("p");
  note.textContent = GIBS_ACKNOWLEDGEMENT;
  details.append(list, note);
  creditsBox.replaceChildren(details);
}

/**
 * The stars are generated, not a catalogue (round-2 plan Q2: no catalogue
 * with a clearly public-domain or attribution-only licence was found), and
 * the credits line says so.
 */
const PROCEDURAL_STARS = "Stars: procedural, not a star catalogue.";

/** The camera's fit: the disc fills 90 % of the narrower side (§7.6). */
const FIT_MARGIN = 0.1;
/**
 * The spin while the page waits for a target, in degrees per second. It
 * starts over the sub-solar point (the day side the fly-in starts from,
 * review 2026-10-01-2124 Major 2); the view's longitude falls, so the
 * surface moves west to east across the screen, the way the Earth turns.
 */
const SPIN_DEG_PER_S = -3;
const DEG = Math.PI / 180;

/**
 * Every lab parameter, its hash key, its default and its range (globe plan
 * §7.8, M4): the panel writes these, a link reproduces a view, and the
 * panel's sliders take their ranges from here (one source). Out of range,
 * empty or malformed reads as the default.
 * - fovY 50° and a pixel-ratio cap of 2 are what the z0-z3 pyramid was
 *   sized for (§7.2, §7.9);
 * - the error target, the sun's intensity and the cache cap default to what
 *   the surface itself sets (`useSurfaceDefaults`), so the lab never
 *   overrides the surface by accident: the error target is the 1 px that
 *   GeneratedSurfacePlugin sets (the library's bare default is 16, which
 *   loads only level 0), the cache floor keeps the surface's floor-to-cap
 *   ratio.
 */
const PARAMS = {
  spinMs: { fallback: 3000, min: 0, max: 10_000 },
  turnMs: { fallback: 5000, min: 0, max: 10_000 },
  // The fly-in (round-5 plan 2026-10-01-0945 §3.1; `turnMs` is its
  // length): how far out it starts, which is also how far the controls may
  // zoom out (km from the centre, DEC-GL5-1), and how far it may turn from
  // the sun side to the target (degrees, DEC-GL5-3). The variant is the
  // `intro=` text key (`readHashParams`).
  maxKm: { fallback: GLOBE_INTRO.maxKm, min: 20_000, max: 100_000 },
  turnCap: { fallback: GLOBE_INTRO.turnCapDeg, min: 0, max: 180 },
  // The pin's dive (round-2 plan 2026-09-26-2055 M3g): its length, the
  // altitude it hands over at (km; the {20, 50, 150} sweep for the look),
  // and whether it then opens the city (0 holds at the hand-over altitude,
  // to look at it).
  diveMs: { fallback: GLOBE_DIVE.durationMs, min: 1000, max: 60_000 },
  // The oblique flight (round-5 plan §3.5, F1): the low pitch of the pitch
  // law (degrees below the horizontal from 1,000 km down; 90 flies the old
  // straight-down dive).
  pitchLow: { fallback: GLOBE_FLIGHT.pitchLowDeg, min: 30, max: 90 },
  // The relief (F1, DEC-GL5-9): 1 draws the library's terrain tiles as the
  // surface, exaggerated by altitude (`exaggerationAt`), in place of the
  // generated globe tiles; 0 (the default until F2) keeps the globe as it
  // was. `reliefNear` is the near-ground exaggeration (3, DEC-GL5-5).
  // The default since F2a (DEC-GL5-15); 0 keeps the plain globe.
  relief: { fallback: 1, min: 0, max: 1 },
  reliefNear: { fallback: GLOBE_FLIGHT.exaggerationNear, min: 1, max: 5 },
  // The height law's third band (city plan 2026-10-05-0040 K1): above 0,
  // E eases from `reliefNear` at 8 km to this value at 2 km and below, so
  // a city can stand on true heights (1); 0 (the default) keeps the law
  // without it. Capped at `reliefNear`.
  reliefGround: { fallback: 0, min: 0, max: 5 },
  // The altitude band (one-scene plan §3.2; km): above `bandHigh` the
  // globe's own surface draws alone, at and below `bandLow` the relief's
  // tiles, a dithered cross-fade between (`carrierShareAt`). Outside the
  // band the other carrier is neither drawn nor updated (so not fetched).
  bandHigh: { fallback: GLOBE_FLIGHT.bandHighM / 1000, min: 200, max: 10_000 },
  bandLow: { fallback: GLOBE_FLIGHT.bandLowM / 1000, min: 100, max: 9_000 },
  // A fixed share in place of the altitude's (null: by altitude), so a
  // smoke can step the cross-fade at one view.
  bandShare: { fallback: null, min: 0, max: 1 },
  // 1 stops both carriers' tile updates (what is loaded stays, nothing
  // refines or unloads), so a smoke can step the share over the same tiles.
  bandFreeze: { fallback: 0, min: 0, max: 1 },
  // How long (ms) a carrier must stay out of the band before its tile cache
  // is released (frame-hitch review 2026-10-03-2017 H4): a zoom that wobbles
  // over an edge never releases, so it never reloads or recompiles.
  bandReleaseMs: { fallback: 5_000, min: 0, max: 60_000 },
  // 1 gates the band's share by readiness (round-6 plan G6-1, DEC-G6-2):
  // a carrier takes pixels only once it can draw them, so no hole shows
  // the background at the switch. 0 follows the altitude alone, as before,
  // for a before/after.
  bandGate: { fallback: 1, min: 0, max: 1 },
  // 1 lets the globe fill every pixel the relief leaves (round-6 plan G6-1,
  // the stencil fill): the relief marks its pixels, the globe draws only
  // where none is, from the coarse tiles it keeps. 0 restores the dither
  // alone, for a before/after. Read at start (it needs a stencil buffer).
  bandFill: { fallback: 1, min: 0, max: 1 },
  // 1: the relief takes over only once its view is refined, so the globe's
  // sharp imagery never gives way to the relief's coarse first tiles
  // (owner 2026-10-04). 0: as soon as its top tiles are loaded.
  bandSharp: { fallback: 1, min: 0, max: 1 },
  // The relief's decoded heights kept past their tiles (MiB; owner decision
  // 2026-10-04, DEC-N1), so a return into the band finds them; 0 keeps none,
  // as before, for a before/after. Read at start.
  keepHeightsMiB: { fallback: 16, min: 0, max: 256 },
  // The world frame at the target (F2 plan F2a, M3): 1 draws the globe in a
  // local frame there (x east, y up, the origin on the ground), which the
  // framework's sky, haze and slab need below the band; 0 keeps the world
  // in ECEF, as before, for a before/after.
  worldFrame: { fallback: 1, min: 0, max: 1 },
  // The clip planes over the drawn relief (F2 plan F2a, M4): 1 fits them to
  // the drawn ground and the highest drawn peak; 0 keeps them over the
  // ellipsoid, as before (the planes smoke's positive control).
  reliefPlanes: { fallback: 1, min: 0, max: 1 },
  // 1 clears the frame magenta instead of black (with the sky off), so a
  // pixel no carrier drew is unambiguous: the hand-over smokes count holes
  // by it (dark water at an oblique view reads near black).
  holeColor: { fallback: 0, min: 0, max: 1 },
  /**
   * The globe's error target while the relief has every pixel and the
   * globe only fills its gaps: coarse, so it keeps to its top tiles.
   */
  bandFillErrorTarget: { fallback: 1e6, min: 1, max: 1e9 },
  // At most this many tiles a released carrier disposes per frame
  // (frame-hitch review 2026-10-03-2017 H4: one frame disposed 188); 0
  // releases the whole cache in one frame, as before, for a before/after.
  bandDrainTiles: { fallback: 8, min: 0, max: 512 },
  // 0 keeps the tile library's whole-tree height-scale step (H1), for a
  // before/after on one preview; read at start.
  lazyE: { fallback: 1, min: 0, max: 1 },
  // globe-albedo's detail on the relief's tiles (the terrain lab's style B
  // high-pass, `globe-detail-region.js`): its weight, 0 off.
  detail: { fallback: GLOBE_ALBEDO.detail, min: 0, max: 1 },
  // Up to 5,000 km since F1, so a smoke can hold inside the altitude band.
  handOverKm: {
    fallback: GLOBE_DIVE.handOverAltitudeM / 1000,
    min: 1,
    max: 5000,
  },
  handOver: { fallback: 1, min: 0, max: 1 },
  // The arrival prefetch (round-5 plan 2026-10-01-0945 §3.6): on unless 0.
  // While it runs it paces the dive (`/globe/flight-pace.js`, at most the
  // 30 s of DEC-GL5-6) unless `diveMs` is set in the hash, which keeps
  // the fixed dive as a manual override.
  prefetch: { fallback: 1, min: 0, max: 1 },
  nightGain: { fallback: GLOBE_SURFACE_TUNING.nightGain, min: 0, max: 4 },
  waterRoughness: {
    fallback: GLOBE_SURFACE_TUNING.waterRoughness,
    min: 0,
    max: 1,
  },
  cloudOpacity: { fallback: GLOBE_SURFACE_TUNING.cloudOpacity, min: 0, max: 1 },
  cloudDrift: { fallback: GLOBE_CLOUD_DRIFT_DEG_PER_S, min: 0, max: 10 },
  sunIntensity: { fallback: null, min: 0, max: 8 },
  // The background pass (on unless 0), the disc's apparent diameter in
  // degrees and the glow's strength (the owner's look by default,
  // round-4 plan 2026-09-28-2105 DEC-GL4-1: `GLOBE_SKY`).
  sky: { fallback: 1, min: 0, max: 1 },
  sunSize: { fallback: GLOBE_SKY.sunDiameterDeg, min: 0.1, max: 10 },
  sunGlow: { fallback: GLOBE_SKY.glow, min: 0, max: 4 },
  // The procedural stars: on unless 0, the magnitude limit, their gain, and
  // the Milky Way band's radiance.
  stars: { fallback: 1, min: 0, max: 1 },
  starMag: {
    fallback: GLOBE_SKY.starMagLimit,
    min: 0.5,
    max: GLOBE_STARS.maxMagLimit,
  },
  // Up to 10 (round-4 plan 2026-09-28-2105 DEC-GL4-2; 4 before).
  starGain: { fallback: GLOBE_SKY.starGain, min: 0, max: 10 },
  milkyWay: { fallback: GLOBE_SKY.milkyWay, min: 0, max: 0.1 },
  // The atmosphere seen from space (round-4 plan 2026-09-28-2105
  // DEC-GL4-4; `globe-atmosphere.js`): on unless 0 (on by default: the
  // owner asked for it), the march's samples per ray, a scale on its light
  // (1 = as computed) and how many times thicker than the real air the
  // shell is drawn (1 = physical).
  atmo: { fallback: 1, min: 0, max: 1 },
  // Fewer samples on a touch screen (review B5; `defaultAtmosphereSteps`).
  atmoSteps: {
    fallback: defaultAtmosphereSteps(
      window.matchMedia?.("(pointer: coarse)").matches === true,
    ),
    min: 2,
    max: 64,
  },
  atmoStrength: { fallback: GLOBE_ATMOSPHERE.strength, min: 0, max: 4 },
  atmoThickness: { fallback: GLOBE_ATMOSPHERE.thickness, min: 1, max: 10 },
  // The halo's thickness on the descent (F2 plan F2b, DEC-GL5-13): 1 eases
  // it from atmoThickness above 2,000 km to 1x below 300 km, so the space
  // pass's shell meets the ground sky; 0 keeps atmoThickness everywhere.
  atmoRamp: { fallback: 1, min: 0, max: 1 },
  // The ground sky below the hand-over edge (F2 plan F2b, M1): the
  // framework's physical sky takes over the sky's pixels, the exposure
  // eased to its own; 0 keeps the space pass all the way down.
  groundSky: { fallback: 1, min: 0, max: 1 },
  // Its edge (km; no ground sky at or above it) and the cross-fade's width
  // below it (km), swept {30, 50, 80} and {10, 20, 40} by the plan.
  skyEdgeKm: { fallback: GLOBE_SKY_HAND_OVER.edgeKm, min: 10, max: 95 },
  skyWidthKm: { fallback: GLOBE_SKY_HAND_OVER.widthKm, min: 1, max: 60 },
  // The ground sky's observer step (percent of the height): one rebuild a
  // step, swept {2, 5, 10}.
  skyStepPct: {
    fallback: GLOBE_SKY_HAND_OVER.altitudeStepPct,
    min: 1,
    max: 20,
  },
  // The haze over the relief below the edge (F2b): the physical extinction
  // times this (0 off), faded in with the ground sky's weight.
  hazeScale: { fallback: 1, min: 0, max: 10 },
  // The cloud volume near the camera (volume-cloud plan 2026-10-05-0016,
  // C2): 0 the shell only (as before), 1 the volume within the disc and the
  // shell outside it, 2 the volume over the shell (the default: the owner's
  // choice 2026-10-05, the only variant measured near no-plop; replacing the
  // shell's soft clouds inside the disc changed the frame by 16 levels).
  cloudVolume: { fallback: 2, min: 0, max: 2 },
  // Its disc (km, the plan's R, swept {10, 20, 40}; 80 since 2026-10-06, so
  // the volume reaches toward the horizon, the slab's reach following it:
  // volume-cloud plan §13) and its ceiling (km; it fades in below it).
  cloudVolumeKm: { fallback: 80, min: 5, max: 200 },
  cloudVolumeCeilingKm: { fallback: 40, min: 10, max: 100 },
  // Its fade-in below the ceiling (km), and the cover's gain on the map
  // (thinner below 1). The gain is 1, the map's own cloud (the owner,
  // 2026-10-06): the 0.5 the no-plop sweep (C4) chose was measured where
  // the volume drew almost nothing (volume-cloud plan §11).
  cloudVolumeFadeKm: { fallback: 25, min: 1, max: 40 },
  cloudVolumeCover: { fallback: 1, min: 0, max: 2 },
  // Whose shadow the ground gets (C3): 0 the shell's soft one (as before), 1
  // the volume's, from the same map through the volume's own clouds.
  cloudShadowFrom: { fallback: 0, min: 0, max: 1 },
  // The city's data warmed from load when the link names a place (`at=`;
  // the city plan 2026-10-05-0040, K0); 0 waits for the pin's press.
  cityWarm: { fallback: 1, min: 0, max: 1 },
  // The reference image's looks (round-4 plan 2026-09-28-2105 DEC-GL4-8),
  // each 0 (off, the look before) to 1: a blue grade over the ground,
  // shaded clouds, a soft blue-grey night with warm lights, navy space and
  // a glow round bright stars.
  grade: { fallback: 0, min: 0, max: 1 },
  cloudRelief: { fallback: 0, min: 0, max: 1 },
  // The clouds on their own shell above the ground (round-6 plan G6-2,
  // DEC-G6-3/4): 1 draws them there, so the ground keeps its colour and the
  // clouds float above the relief; 0 paints them into the ground, as before.
  cloudShell: { fallback: 1, min: 0, max: 1 },
  // The shell's height over the ground (km), times the relief's
  // exaggeration E, as the relief is raised (DEC-G6-3: 3 km x E).
  cloudShellKm: { fallback: 3, min: 0, max: 30 },
  // The soft cloud shadow on the ground with the shell (DEC-G6-4), 0 off.
  cloudShadow: { fallback: 0.6, min: 0, max: 1 },
  twilight: { fallback: 0, min: 0, max: 1 },
  // The sky fill's floor (DEC-GL5-11; the terrain lab's `sky` key, the
  // Globe package's one sky level): what a low sun's ground keeps from the
  // sky. 0 is the look before the fill. Not `sky`, which is the
  // background pass's switch on this page.
  skyFloor: { fallback: SKY_FILL.floor, min: 0, max: 1 },
  // 0.1 by default (round-5 plan DEC-GL5-4: navy space).
  space: { fallback: 0.1, min: 0, max: 1 },
  starGlow: { fallback: 0, min: 0, max: 1 },
  fovY: { fallback: 50, min: 20, max: 80 },
  pixelRatio: { fallback: 2, min: 0.5, max: 4 },
  errorTarget: { fallback: null, min: 0.25, max: 256 },
  cacheMiB: { fallback: null, min: 8, max: 4096 },
  // The controls' height adjustment (frame-hitch plan 2026-10-03-2017 §4.2,
  // H5): 1 the library's default, 0 removes its two raycasts a frame.
  adjustHeight: { fallback: 1, min: 0, max: 1 },
  // The relief's cache cap (MiB; its floor keeps the same ratio) and its
  // queues (§4.3), settable within one page load.
  reliefCacheMiB: {
    fallback: GLOBE_TERRAIN.cacheBytes / 2 ** 20,
    min: 8,
    max: 4096,
  },
  parseJobs: { fallback: 5, min: 1, max: 32 },
  downloadsPerOrigin: { fallback: 25, min: 1, max: 64 },
  // The frame-hitch recorder (`globe-perf.js`, §4): 1 loads it and shows
  // its overlay; without it the page does no recorder work. `perfStep` 1
  // flies the frame-stepped path (SwiftShader: counts only) at
  // `perfSteps` steps a decade, each settle checkpoint held at most
  // `perfSettleS`; `perfSpeed` (decades a second) replaces every run's
  // speed, for short runs. The sweep and the place are the text keys
  // `perfSweep` and `perfPlace` (`readHashParams`).
  perf: { fallback: 0, min: 0, max: 1 },
  perfStep: { fallback: 0, min: 0, max: 1 },
  perfSteps: { fallback: 40, min: 1, max: 200 },
  perfSettleS: { fallback: 120, min: 1, max: 600 },
  perfSpeed: { fallback: null, min: 0.05, max: 20 },
};

/** The sweeps the recorder knows (`/globe/globe-perf-sweep.js`). */
const PERF_SWEEPS = ["quick", "full", "overhead"];

/** The highest real peak (m, Everest rounded up): the far plane's reach (F2a, M4). */
const RELIEF_PEAK_M = 8_850;

/** The floor the relief keeps under its cache cap, as a fraction of it. */
const RELIEF_FLOOR_RATIO =
  GLOBE_TERRAIN.cacheFloorBytes / GLOBE_TERRAIN.cacheBytes;

/** The floor the surface keeps under its cache cap, as a fraction of it. */
const CACHE_FLOOR_RATIO =
  GLOBE_SURFACE.cacheFloorBytes / GLOBE_SURFACE.cacheBytes;

/** The defaults the surface sets itself, read from the live surface. */
function useSurfaceDefaults(globe) {
  PARAMS.errorTarget.fallback = globe.tiles.errorTarget;
  PARAMS.sunIntensity.fallback = globe.sun.intensity;
  PARAMS.cacheMiB.fallback = GLOBE_SURFACE.cacheBytes / 2 ** 20;
}

/** A number from the hash within its range, or its default. */
function readParam(params, name) {
  const { fallback, min, max } = PARAMS[name];
  const text = params.get(name);
  const value = Number(text);
  return text !== null && text.trim() !== "" && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * The lab's parameters from the hash: `#at=<lat>,<lng>`, the clock
 * (`time=<ISO>` pins the instant, `timeScale=<n>` runs it; the globe
 * package's `globe-clock.ts`), and PARAMS. `timeScale` is the clock's
 * EFFECTIVE scale, which the plate shows.
 */
function readHashParams() {
  const params = new URLSearchParams(location.hash.slice(1));
  const values = Object.fromEntries(
    Object.keys(PARAMS).map((name) => [name, readParam(params, name)]),
  );
  const clock = readGlobeClockSetting(params);
  return {
    ...values,
    // Where the relief's heights come from: the live Terrarium tiles, or
    // `synthetic` (generated in the page, for the smokes: no network).
    reliefHeights:
      params.get("reliefHeights") === "synthetic" ? "synthetic" : "terrarium",
    url: parseLatLngText(params.get("at")),
    // The fly-in's variant (round-5 plan §3.1): one of INTRO_VARIANTS,
    // `narrow` (the default case) when absent or unknown.
    intro: INTRO_VARIANTS.includes(params.get("intro"))
      ? params.get("intro")
      : "narrow",
    clock,
    timeScale: clock.scale ?? (clock.startMs === null ? 1 : 0),
    // The recorder's sweep (null: one run) and the place of a single run
    // (an id of `PERF_PLACES`; an unknown one flies the Alps).
    perfSweep: PERF_SWEEPS.includes(params.get("perfSweep"))
      ? params.get("perfSweep")
      : null,
    perfPlace: /^[a-z]{1,16}$/.test(params.get("perfPlace") ?? "")
      ? params.get("perfPlace")
      : "alps",
    // `controls` drives every recorder run through the controls' wheel
    // input; absent, each cell says (`/globe/globe-perf-sweep.js`).
    perfDrive: params.get("perfDrive") === "controls" ? "controls" : null,
  };
}

/** What restarts the intro when it changes; everything else applies live. */
const flightKey = (p) =>
  JSON.stringify([
    p.url?.lat,
    p.url?.lng,
    p.spinMs,
    p.turnMs,
    p.intro,
    p.maxKm,
    p.turnCap,
  ]);

/**
 * How long the field of view takes to ease back to the lab's `fovY` when
 * the fly-in is interrupted (a press, the pin's dive) while a variant has
 * it wider or narrower (round-5 plan §3.1): no snap, and no interim value
 * left behind.
 */
const FOV_RETURN_MS = 500;

/** A north-up orbit pose for a direction [x, y, z] from the centre. */
function poseToward([x, y, z]) {
  const direction = new THREE.Vector3(x, y, z).normalize();
  const up = new THREE.Vector3(0, 0, 1);
  up.addScaledVector(direction, -up.dot(direction));
  if (up.lengthSq() < 1e-12) {
    up.set(1, 0, 0).addScaledVector(direction, -direction.x);
  }
  return { direction, up: up.normalize() };
}

const asArray = (v) => [v.x, v.y, v.z];

/**
 * The intro's states (globe plan §7.6): `spin` until a target is chosen,
 * `turning` towards it, then `arrived`, holding it; `user` once the user
 * has taken the camera (round-2 plan 2026-09-26-2055 M3a); `diving` down
 * to the pin's position and `landed` at the hand-over altitude (M3g).
 * `pose(now)` returns either an orbit `pose` (the fitted distance
 * applies) or, during the dive, the camera's `position` and `quaternion`
 * (`diveStep` in `/globe/globe-dive.js`). `history` records each
 * phase and source change with its time since the start, and `runs`
 * counts the starts (the replay button, a change of target or timing), so
 * a test reads the sequence instead of racing it.
 *
 * Round 5 (plan 2026-10-01-0945 §3.1): `turning` is the FLY-IN
 * (`/globe/globe-intro.js`): from the zoom-out limit (`zoomOutM`: at least
 * `maxKm`, the library's own limit and twice the fit) on the sun side (the
 * target turned towards the sub-solar point by at most `turnCap`) to the
 * target at the fitted distance, over `turnMs`, in the `intro` variant; it
 * ends at the lab's `fovY` (50 by default, DEC-GL5-2). While it waits for a
 * target it spins out there, over the sub-solar side; when a target
 * arrives (a link, a position, the fallback) the start is computed from it
 * and, if the spin was shown, blended to from the spin's direction over
 * 1.5 s (review 2026-10-01-2124 Major 2: before, a position arriving after
 * the first frame started from wherever the spin was, without the sun
 * side or the cap). The start follows the target as it is then, so a
 * position that replaces the fallback keeps the cap. A position that arrives while the fallback is
 * flown to or held becomes the target over 1.5 s (`setFix`); without a
 * granted permission none will come (`noFixComing`), so it does not wait.
 * `pose(now)` adds `distanceM` (null: the fitted distance) and `fovDeg`.
 */
function introFlight(ellipsoid, { sunEcef, fitDistance, zoomOutM }) {
  let params;
  let startedAt;
  let phase;
  let choice;
  let to;
  let turnStartedAt;
  let history;
  let runs = 0;
  /** The dive in progress (`planDive`) and when it began. */
  let dive = null;
  let diveStartedAt = 0;
  /**
   * The dive's elapsed time from the real one (`globe-arrival.js`'s dive
   * clock: as it is when fixed, the paced path when the prefetch runs).
   */
  let diveClock = (elapsedMs) => elapsedMs;
  /** A fixed dive time (ms) the pose holds at, for the smokes; null: run. */
  let diveHoldMs = null;
  /**
   * The target's arrival: when, the spin's direction then, and how long the
   * start blends from it (0 when no spin frame was drawn).
   */
  let arrival = null;
  let spinShown = false;
  /** The camera's direction on the fly-in's first frame, for the smokes. */
  let firstTurn = null;
  /**
   * The camera's distance from the centre (m) on the fly-in's first frame,
   * as the frame loop placed it (`cameraPlaced`), for the smokes; and
   * whether the pose just returned is that first frame's.
   */
  let firstTurnDistanceM = null;
  let firstTurnPending = false;
  /** A position from the permission rule, and whether none will come. */
  let fix = null;
  let noFix = false;
  /** A late position blending in: from, to (directions) and since when. */
  let blend = null;
  const note = (now) => {
    history.push({
      phase,
      source: choice.source,
      atMs: Math.round(now - startedAt),
    });
  };
  const restart = (now, next) => {
    params = next;
    startedAt = now;
    phase = "spin";
    choice = { target: null, source: "waiting" };
    history = [];
    runs += 1;
    dive = null;
    arrival = null;
    spinShown = false;
    firstTurn = null;
    firstTurnDistanceM = null;
    firstTurnPending = false;
    blend = null;
    note(now);
  };
  /** The variant's field of view at the fly-in's start. */
  const startFov = () =>
    introCameraPose(0, {
      variant: params.intro,
      start: [1, 0, 0],
      target: [1, 0, 0],
      startKm: zoomOutM() / 1000,
      endKm: zoomOutM() / 1000,
      endFovDeg: params.fovY,
    }).fovDeg;
  /** The target's direction now, a late fix blending in. */
  const targetDirection = (now) => {
    if (!blend) return asArray(to.direction);
    const d = blendTarget(
      blend.from,
      blend.to,
      now - blend.at,
      GLOBE_INTRO.lateFixBlendMs,
    );
    if (now - blend.at >= GLOBE_INTRO.lateFixBlendMs) blend = null;
    return d;
  };
  const spinPose = (now) =>
    poseToward(
      spinDirection(asArray(sunEcef()), now - startedAt, SPIN_DEG_PER_S),
    );
  /** The fly-in's start now: from the spin to the target's sun side. */
  const startDirection = (now) =>
    flyInStart({
      spin: arrival.spin,
      target: targetDirection(now),
      sun: asArray(sunEcef()),
      capDeg: params.turnCap,
      sinceArrivalMs: Math.max(0, now - arrival.at),
      blendMs: arrival.blendMs,
    });
  /** The spin, the turn and the hold. */
  const introPose = (now) => {
    if (phase === "spin") {
      const next = chooseGlobeTarget({
        url: params.url,
        fix,
        fallback: GLOBE_FALLBACK_TARGET,
        fixWaitExpired: noFix || now - startedAt >= params.spinMs,
      });
      if (next.source !== choice.source) {
        choice = next;
        if (next.target) {
          to = orbitPose(ellipsoid, next.target);
          arrival = {
            at: now,
            spin: asArray(spinPose(now).direction),
            blendMs: spinShown ? GLOBE_INTRO.lateFixBlendMs : 0,
          };
          turnStartedAt = now;
          phase = "turning";
        }
        note(now);
      }
      if (phase === "spin") {
        spinShown = true;
        return {
          pose: spinPose(now),
          distanceM: zoomOutM(),
          fovDeg: startFov(),
        };
      }
    }
    if (phase === "turning") {
      const t = params.turnMs > 0 ? (now - turnStartedAt) / params.turnMs : 1;
      if (t < 1) {
        const p = introCameraPose(t, {
          variant: params.intro,
          start: startDirection(now),
          target: targetDirection(now),
          startKm: zoomOutM() / 1000,
          endKm: fitDistance() / 1000,
          endFovDeg: params.fovY,
        });
        if (firstTurn === null) {
          firstTurn = [...p.direction];
          firstTurnPending = true;
        }
        return {
          pose: poseToward(p.direction),
          distanceM: p.distanceKm * 1000,
          fovDeg: p.fovDeg,
        };
      }
      phase = "arrived";
      note(now);
    }
    return {
      pose: blend ? poseToward(targetDirection(now)) : to,
      distanceM: null,
      fovDeg: params.fovY,
    };
  };
  return {
    restart,
    /**
     * A position from the permission rule (round-5 plan §3.1): while the
     * spin waits it becomes the target; while the fallback is flown to or
     * held, the target blends over to it in 1.5 s (no jump).
     */
    setFix(next, now) {
      fix = next;
      if (choice.source !== "fallback") return;
      if (phase !== "turning" && phase !== "arrived") return;
      const toNext = orbitPose(ellipsoid, next);
      blend = {
        from: targetDirection(now),
        to: asArray(toNext.direction),
        at: now,
      };
      to = toNext;
      choice = { target: next, source: "fix" };
      note(now);
    },
    /** No position will come (no granted permission): do not wait for one. */
    noFixComing() {
      noFix = true;
    },
    /**
     * The user took the camera (a drag, a pinch, a wheel, a double tap):
     * the intro stops where it is, as the phase `user`, until a restart
     * gives the camera back.
     */
    yieldToUser(now) {
      if (phase === "user") return;
      phase = "user";
      note(now);
    },
    /** Whether the intro drives the camera: every phase but `user`. */
    get drives() {
      return phase !== "user";
    },
    /**
     * The pin's dive (round-2 plan M3g): from the camera as it is (`start`:
     * its orbit pose, distance and rotation), turn to `target` and descend
     * to `toAltitudeM` over `durationMs` (`planDive` in
     * `/globe/globe-dive.js`: the height above the surface along the
     * camera's own direction, the start's tilt fading out), then hold there
     * as `landed`.
     */
    dive(now, target, start, { durationMs, toAltitudeM, clock }) {
      dive = planDive(ellipsoid, start, orbitPose(ellipsoid, target), {
        durationMs,
        toAltitudeM,
        pitchLowDeg: params.pitchLow,
      });
      diveStartedAt = now;
      diveHoldMs = null;
      diveClock = clock ?? ((elapsedMs) => elapsedMs);
      choice = { target, source: "pin" };
      phase = "diving";
      note(now);
    },
    /**
     * For the smokes: hold the camera at a dive time (ms, null to run on),
     * and read the dive's altitude at a time without moving the camera.
     * Null without a dive.
     */
    holdDiveAt(ms) {
      if (!dive) return null;
      diveHoldMs = ms;
      return diveStep(dive, ms ?? 0).altitudeM;
    },
    diveAltitudeAt(ms) {
      return dive ? diveStep(dive, ms).altitudeM : null;
    },
    /** The pose for this frame, advancing the states. */
    pose(now) {
      if (phase === "diving" || phase === "landed") {
        const step = diveStep(
          dive,
          diveHoldMs ?? diveClock(now - diveStartedAt),
        );
        if (step.done && phase === "diving") {
          phase = "landed";
          note(now);
        }
        return step;
      }
      return introPose(now);
    },
    /**
     * The frame loop placed the camera at `distanceM` from the centre:
     * kept when it was the fly-in's first frame.
     */
    cameraPlaced(distanceM) {
      if (!firstTurnPending) return;
      firstTurnPending = false;
      firstTurnDistanceM = distanceM;
    },
    state: () => ({
      phase,
      target: choice.target,
      source: choice.source,
      history: history.slice(),
      runs,
      spinMs: params.spinMs,
      turnMs: params.turnMs,
      intro: params.intro,
      fixState: fix ? "fix" : noFix ? "none" : "waiting",
      // The fly-in's start as it is now (unit vector, ECEF), and the sun's
      // direction, for the smokes; null before a target arrived.
      flyInStart:
        arrival && phase !== "diving" && phase !== "landed"
          ? startDirection(performance.now())
          : null,
      firstTurn,
      firstTurnDistanceM,
      // How long the start blends from the spin (0: no spin was shown),
      // and whether that blend is over.
      flyInBlendMs: arrival?.blendMs ?? null,
      flyInSettled: arrival
        ? performance.now() - arrival.at >= arrival.blendMs
        : false,
    }),
  };
}

/**
 * Touch and mouse (round-2 plan 2026-09-26-2055 M3a): the tile library's
 * own `GlobeControls` on the canvas. One finger (or the left button) on
 * the Earth drags it round, a pinch or the wheel zooms, a double tap zooms
 * in. Two fingers moved together (or the right button) tilt, but only once
 * zoomed in: farther out than where the Earth spans the narrower side of
 * the view (about 7,300 km up at fovY 50° on a landscape screen, about
 * 24,000 km on a portrait phone) the library turns tilting off. A
 * one-finger swipe beside the globe, on space, does nothing: a press takes
 * the camera only where its ray hits the Earth.
 * The camera has ONE owner at a time:
 * - the intro (spin, turn, hold) while `flight.drives`: it sets the pose
 *   AND the clip planes (`followIntro`, from the height above the ground,
 *   so a close view never clips the ground and the far side is culled), and the
 *   controls are not updated;
 * - the controls once the user touches: their `start` event (a press on
 *   the Earth, a wheel step, a double tap) calls `onTake`, which stops the
 *   intro, and from then on only `update` moves the camera, including its
 *   planes (the library sets them itself);
 * - the replay button and a new target or timing in the hash give the
 *   camera back: `release` drops any drag and leftover momentum, so the
 *   next touch starts clean.
 * The controls stay enabled throughout, because a disabled control ignores
 * the very press that should take the camera; the intro keeps their up
 * direction in step so that press finds the Earth under the pointer.
 * Cost to measure on a phone: while the controls own the camera, each
 * frame raycasts the tiles twice (the library's height adjustment, in
 * `update` and in `adjustCamera`); `adjustHeight = false` removes both
 * if they show.
 */
function cameraControls(
  scene,
  camera,
  globe,
  onTake,
  reliefPlanes = () => ({}),
) {
  const controls = new GlobeControls(scene, camera, canvas);
  controls.setEllipsoid(globe.tiles.ellipsoid, globe.tiles.group);
  controls.enableDamping = true;
  controls.addEventListener("start", onTake);
  const local = new THREE.Vector3();
  let picking = scene;
  /**
   * The clip planes from the distance to the nearest drawn ground and the
   * highest drawn peak (F2 plan F2a, M4), whoever owns the camera: after
   * the intro places it, after the controls' own update (which sets planes
   * of its own over the ellipsoid), and once more after the clearance's
   * lift, which moves the camera later in the frame (`fitPlanes`).
   */
  const fitPlanes = () => {
    local.copy(camera.position);
    globe.tiles.group.worldToLocal(local);
    const { near, far } = clipPlanes(
      globe.tiles.ellipsoid,
      local,
      reliefPlanes(),
    );
    if (camera.near !== near || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  };
  return {
    /**
     * Fits the planes to where the camera is now: the frame calls it last,
     * after every writer (F2a's browser run, 2026-10-05: fitted before the
     * clearance's lift, the planes belonged to the dive's raw height, 3 km
     * under the drawn ground, and the near plane cut into the ground).
     */
    fitPlanes,
    followIntro() {
      fitPlanes();
      controls.getCameraUpDirection(controls.up);
    },
    update() {
      controls.update();
      fitPlanes();
    },
    /**
     * What the controls' rays hit (F2a, M4; F1 review Major 5): the carrier
     * drawing most of the frame, not the whole scene (the cloud shell, the
     * other carrier).
     */
    pickFrom(object) {
      if (picking !== object) {
        picking = object;
        controls.setScene(object);
      }
    },
    /** The farthest the controls zoom out: a getter, metres from the centre. */
    limit(limitM) {
      limitGlobeZoomOut(controls, limitM);
    },
    /** The library's height adjustment (its two raycasts a frame, H5). */
    setAdjustHeight(on) {
      controls.adjustHeight = on;
    },
    release() {
      // Toggling `enabled` is the library's own reset: it ends any drag,
      // forgets the pointers and drops the drag and rotation momentum. The
      // globe's spin momentum and a pending wheel step are cleared here.
      controls.enabled = false;
      controls.enabled = true;
      controls.zoomDelta = 0;
      controls.globeInertia.identity();
      controls.globeInertiaFactor = 0;
    },
  };
}

/** How long the pin waits for a fix, as OsmDemo's locate button does. */
const LOCATE_TIMEOUT_MS = 15_000;

/**
 * The camera's current pose as an orbit pose: the direction from the
 * centre, and the screen's up made perpendicular to it (or, looking
 * straight along it, the view's forward direction, then north). From the
 * camera's ECEF pose (`ecefPoseOf`, F2a): the world is not ECEF once the
 * frame is at a target.
 */
function currentPose({ position, quaternion }) {
  const direction = position.clone().normalize();
  for (const axis of [
    new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
    new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion),
    new THREE.Vector3(0, 0, 1),
  ]) {
    const up = axis.addScaledVector(direction, -axis.dot(direction));
    if (up.lengthSq() > 1e-12) return { direction, up: up.normalize() };
  }
  return { direction, up: new THREE.Vector3(1, 0, 0) };
}

/**
 * The pin (round-2 plan 2026-09-26-2055 M3g, DEC-FB2-2/3), bottom right as
 * in OsmDemo: a press asks for the position (the framework's `locateOnce`),
 * the globe then turns and dives there over `diveMs` to `handOverKm`, and
 * the page opens OsmDemo's city at that place (`handOverUrl`), with the
 * globe's time when the sun is up there. Its phases and labels are
 * `/globe/globe-pin.js`'s; the button carries them in its `aria-label`,
 * `title`, `aria-busy`, `disabled` and `data-state` (the design system's
 * locate atom: `locating` pulses), and the status line beside it shows the
 * in-progress label or the failure with its fix (`labelFor`,
 * `locateAdvice`). A press or a touch on the globe stops the flight and
 * leaves the camera to the controls; a restart of the intro (the replay
 * button, a new target) ends a flight too. `handOver=0` holds at the
 * hand-over altitude instead of leaving, to look at it. `navigate` is
 * `location.assign` (the page leaves).
 *
 * THE ARRIVAL PREFETCH (round-5 plan 2026-10-01-0945 §3.6 step 1): once the
 * position is known, the lab loads OsmDemo's `/osm/arrival-prefetch.js`
 * with a dynamic import (its graph, the Osm library and H3, about 1.7 MB,
 * stays out of the boot) and starts it for the target, so the city opens
 * on a warm cache. Its progress paces the dive (`createDiveClock`: the
 * flight's path over at most the 30 s cap of DEC-GL5-6, about 8.6 s when
 * the data is already stored); `diveMs` set in the hash keeps the fixed
 * dive instead, and `prefetch=0` turns it off. A module that does not
 * load counts as done (nothing can be warmed, so nothing is waited for).
 * Every way a flight stops (a press, a touch, a hidden page) aborts it.
 * The hand-over does not wait past the dive: the paced dive lands when the
 * data is in or at the cap, and then hands over at once (holding longer is
 * an open decision, the round-5 results' Q2). The status line beside the
 * pin (`#globe-arrival-status`) shows the tiles warmed of the total, cold
 * or warm, then how it ended (`arrivalStatusText`).
 */
function bindPin({
  flight,
  controls,
  camera,
  getParams,
  sceneMs,
  navigate,
  diveFloorM = () => 0,
  onLocated = () => {},
  ecefCamera,
  setFrameTarget = () => {},
}) {
  let phase = "idle";
  let message = "";
  let lastUrl = null;
  let located = null;
  /** The last failure (denied, timeout, unavailable), until the next press. */
  let failure = null;
  /**
   * The current flight's arrival prefetch: the module's handle once loaded
   * (`prefetch`), whether its module failed to load (`gaveUp`), whether the
   * flight was stopped (`stopped`), its final `outcome`, and the dive
   * clock it paces. Null before the first flight.
   */
  let arrival = null;
  let arrivalLine = "";
  const NO_JOBS = { total: 0, warm: 0, fetched: 0, failed: 0 };
  const arrivalCounts = () =>
    arrival?.prefetch?.stats().counts ?? { overpass: NO_JOBS, dem: NO_JOBS };
  const arrivalProgress = () => {
    if (!arrival) return 0;
    if (arrival.gaveUp) return 1;
    return arrival.prefetch?.progress() ?? 0;
  };
  const renderArrival = () => {
    const text =
      arrival && arrival.outcome !== "off"
        ? arrivalStatusText({
            outcome: arrival.outcome,
            counts: arrivalCounts(),
          })
        : "";
    if (text === arrivalLine) return;
    arrivalLine = text;
    arrivalStatus.textContent = text;
    arrivalStatus.hidden = text === "";
  };
  /** Stops the current prefetch, if it still runs. */
  const stopArrival = () => {
    if (!arrival || arrival.stopped) return;
    arrival.stopped = true;
    if (arrival.outcome === null) {
      arrival.prefetch?.abort();
      arrival.outcome = "aborted";
    }
    renderArrival();
  };
  /**
   * Starts the arrival prefetch for `target` and returns the dive's clock
   * (`flight.dive`'s `clock`): paced by it, or fixed by `diveMs`.
   */
  const startArrival = (target, params) => {
    stopArrival();
    const enabled = params.prefetch !== 0;
    const manual = new URLSearchParams(location.hash.slice(1)).has("diveMs");
    const clock = createDiveClock(
      enabled && !manual
        ? {
            kind: "paced",
            durationMs: params.diveMs,
            pace: FLIGHT_PACE_DEFAULTS,
          }
        : { kind: "fixed", durationMs: params.diveMs },
    );
    const mine = {
      prefetch: null,
      gaveUp: false,
      stopped: false,
      outcome: enabled ? null : "off",
      clock,
    };
    arrival = mine;
    if (enabled) {
      // A literal specifier: the deploy crawl ships the module and its
      // graph from it (`build-lookdev.mjs`), and nothing loads at boot.
      import("/osm/arrival-prefetch.js").then(
        ({ startArrivalPrefetch }) => {
          if (mine.stopped) return;
          mine.prefetch = startArrivalPrefetch(target);
          void mine.prefetch.finished.then((report) => {
            if (mine.outcome === null) mine.outcome = report.outcome;
            renderArrival();
          });
        },
        () => {
          mine.gaveUp = true;
          if (mine.outcome === null) mine.outcome = "unavailable";
          renderArrival();
        },
      );
    }
    renderArrival();
    return (elapsedMs) => clock.elapsedMs(elapsedMs, arrivalProgress());
  };
  const render = () => {
    const view = globePinView(phase);
    pinButton.setAttribute("aria-label", view.label);
    pinButton.title = view.label;
    pinButton.setAttribute("aria-busy", String(view.busy));
    pinButton.disabled = view.disabled;
    // The locate atom's looks: pulsing while locating, engaged in flight,
    // the warning dot after a failure.
    pinButton.dataset.state =
      phase === "idle"
        ? (failure ?? "idle")
        : phase === "locating"
          ? "locating"
          : "located";
    pinStatus.textContent = phase === "idle" ? message : view.label;
  };
  const go = (event) => {
    phase = nextPinPhase(phase, event);
    render();
  };
  /** The globe's instant as OsmDemo reads it, at the target. */
  const sunAt = (target) => {
    const ms = sceneMs();
    return {
      date: solarDateAt(ms, target.lng),
      solarHours: apparentSolarTimeHours(ms, target.lng),
      elevationDeg:
        solarPosition(ms, target.lat, target.lng).elevationRad / DEG,
    };
  };
  /** Bumped by every press, so an answer to a cancelled request is dropped. */
  let request = 0;
  pinButton.addEventListener("click", async () => {
    const before = phase;
    const mine = ++request;
    failure = null;
    go("press");
    if (before === "flying") {
      // Stopped: the camera stays where the flight left it, for the controls.
      flight.yieldToUser(performance.now());
      stopArrival();
      return;
    }
    if (before === "locating") {
      // Cancelled: a browser can leave the request pending (an open
      // permission prompt), and the pin must not be stuck with it.
      message = "Stopped looking for your location.";
      render();
      return;
    }
    if (phase !== "locating") return;
    message = "";
    const outcome = await locateOnce(navigator.geolocation, {
      timeoutMs: LOCATE_TIMEOUT_MS,
    });
    if (mine !== request || phase !== "locating") return;
    if (outcome.kind === "failed") {
      message = `${labelFor(outcome.state)}: ${locateAdvice(outcome.state)}`;
      failure = outcome.state;
      go("failed");
      return;
    }
    located = { lat: outcome.fix.lat, lng: outcome.fix.lng };
    const params = getParams();
    onLocated(located, params);
    // The intro takes the camera: no drag or momentum left to resume.
    controls.release();
    const clock = startArrival(located, params);
    // The world frame moves to the target at the press, the view unchanged
    // (F2a): the dive then runs in the target's local frame.
    setFrameTarget(located);
    const start = ecefCamera();
    flight.dive(
      performance.now(),
      located,
      {
        pose: currentPose(start),
        distanceM: start.position.length(),
        quaternion: start.quaternion,
      },
      {
        durationMs: params.diveMs,
        // The clearance rule (one-scene plan §3.4): never closer to the
        // exaggerated ground under the target than the clearance.
        toAltitudeM: Math.max(params.handOverKm * 1000, diveFloorM(located)),
        clock,
      },
    );
    go("located");
  });
  render();
  return {
    /**
     * Starts the city's prefetch for `target` before any press (the city
     * plan 2026-10-05-0040, K0): a link that names a place warms its data
     * while the globe still turns. A later press restarts it for the place
     * it locates; what was stored counts as warm. Nothing while flying, and
     * nothing with `prefetch=0`.
     */
    warm(target) {
      if (phase === "flying" || getParams().prefetch === 0) return;
      startArrival(target, getParams());
    },
    /** The controls took the camera, or the intro restarted. */
    cameraTaken() {
      if (phase !== "flying") return;
      stopArrival();
      go("touch");
    },
    /**
     * The page is hidden (another tab, a locked phone) while flying: the
     * flight stops as a touch stops it, and the camera stays where it is,
     * for the controls. Without it the dive would run on in the background
     * and hand over the moment the page is seen again (milestone review m4;
     * pausing the dive's clock instead would need a second clock).
     */
    hidden() {
      if (phase !== "flying") return;
      flight.yieldToUser(performance.now());
      stopArrival();
      message = "Stopped: the page was hidden. Tap the pin to fly again.";
      go("touch");
    },
    /**
     * Back from the city: the browser restored this page from its
     * back-forward cache as it was left, handing over (milestone review M2).
     * The pin is idle again; the view holds where the dive ended, and a
     * press starts a new flight from there.
     */
    returned() {
      if (phase !== "handingOver") return;
      message = "Back from the city.";
      go("returned");
    },
    /** Per frame: the status line follows; a landed dive hands over (or holds). */
    frame() {
      renderArrival();
      if (phase !== "flying" || flight.state().phase !== "landed") return;
      if (getParams().handOver === 0) {
        message = `Arrived ${shown(getParams().handOverKm)} km above you (the hand-over is off).`;
        go("held");
        return;
      }
      lastUrl = handOverUrl({
        pageHref: location.href,
        target: located,
        sun: sunAt(located),
      });
      go("arrived");
      // The dive has landed: the data is in, or the cap has passed. Nothing
      // waits longer (the round-5 results' Q2); the page leaves now.
      stopArrival();
      navigate(lastUrl);
    },
    state: () => ({
      phase,
      label: globePinView(phase).label,
      status: pinStatus.textContent,
      located,
      handOverUrl: lastUrl,
      // The arrival prefetch of the current flight (null before one).
      arrival: arrival && {
        outcome: arrival.outcome,
        progress: arrivalProgress(),
        counts: arrivalCounts(),
        paced: arrival.clock.paced,
        rate: arrival.clock.rate(),
        line: arrivalLine,
      },
    }),
  };
}

/**
 * The hash with one key set (null removes it), kept readable: a link's
 * `at=30,15` and `time=...T11:00:00Z` stay as typed instead of %2C / %3A.
 */
function hashWith(key, value) {
  return hashWithAll({ [key]: value });
}

/** The hash with several keys set at once (null removes one). */
function hashWithAll(values) {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [key, value] of Object.entries(values)) {
    if (value === null) params.delete(key);
    else params.set(key, String(value));
  }
  return params.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
}

/** A value for an output label: at most two decimals, no trailing zeros. */
const shown = (value) => String(Math.round(value * 100) / 100);

/**
 * The control plate (globe plan §7.8, M4): every control writes its hash
 * key, so the hash stays the one state and a link reproduces the view; the
 * controls follow the hash back (a pasted link, an edited hash). A control
 * REPLACES the history entry and applies at once through `apply`, so a
 * slider drag neither floods the back button nor waits for `hashchange`.
 * The hour slider sets the UTC hour of `#time=` (the clock's date; minutes
 * snap to its 15-minute steps); "Now" removes `#time=`. `sceneMs` reads
 * the clock, `clockScale` its effective speed. A change of the clock's
 * speed also pins `time=` to the instant it is made at, so the scene
 * carries on from there instead of rewinding to the old pin. Returns
 * `sync` (the controls from the hash) and `showClock` (the hour label and
 * slider from the clock, which the frame calls while the clock runs).
 */
function bindPanel(getParams, apply, sceneMs, clockScale) {
  const fields = [...document.querySelectorAll("[data-hash-key]")];
  const hour = document.querySelector("[data-time-hour]");
  const now = document.querySelector("[data-time-now]");
  const write = (key, value) => {
    const values =
      key === "timeScale"
        ? { time: new Date(sceneMs()).toISOString(), timeScale: value }
        : { [key]: value };
    history.replaceState(null, "", `#${hashWithAll(values)}`);
    apply();
  };
  const show = (key, value) => {
    const out = document.querySelector(`output[data-for="${key}"]`);
    if (out) out.textContent = value;
  };
  for (const field of fields) {
    const range = PARAMS[field.dataset.hashKey];
    if (field.tagName !== "SELECT") {
      field.min = String(range.min);
      field.max = String(range.max);
    }
  }
  const sync = () => {
    const params = getParams();
    for (const field of fields) {
      const key = field.dataset.hashKey;
      const value = String(params[key]);
      // A value the hash allows but the select does not list still shows.
      if (
        field.tagName === "SELECT" &&
        ![...field.options].some((o) => o.value === value)
      ) {
        field.add(new Option(value, value));
      }
      field.value = value;
      show(key, shown(params[key]));
    }
    showClock();
  };
  /**
   * The hour label and slider from the clock: "now" for the wall clock,
   * otherwise the UTC hour, and the speed while it runs faster or slower
   * than real time. The slider is left alone while it is being dragged.
   */
  const showClock = () => {
    const date = new Date(sceneMs());
    const h = date.getUTCHours() + date.getUTCMinutes() / 60;
    if (document.activeElement !== hour) hour.value = String(h);
    const scale = clockScale();
    const wall = getParams().clock.startMs === null && scale === 1;
    const speed = scale === 0 || scale === 1 ? "" : `, x${scale}`;
    show("hour", wall ? "now" : `${shown(h)} UTC${speed}`);
  };
  for (const field of fields) {
    const event = field.tagName === "SELECT" ? "change" : "input";
    field.addEventListener(event, () =>
      write(field.dataset.hashKey, field.value),
    );
  }
  hour.addEventListener("input", () => {
    const date = new Date(sceneMs());
    date.setUTCHours(0, Math.round(Number(hour.value) * 60), 0, 0);
    write("time", date.toISOString());
  });
  now.addEventListener("click", () => write("time", null));
  return { sync, showClock };
}

/**
 * Bytes fetched for the globe's assets so far (the resource timing log):
 * `transferSize`, or the body size where that reads 0. A cache hit
 * therefore still counts, so this is "bytes the page needed", which equals
 * the download only with no cache (the measure tool: `no-store`, a fresh
 * context per row).
 */
function globeBytesDownloaded() {
  return performance
    .getEntriesByType("resource")
    .filter((e) => e.name.includes("/globe-assets/"))
    .reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0);
}

/**
 * The imagery tiles requested so far per pyramid level (distinct URLs in the
 * resource timing log), index = level: which levels a view actually uses.
 * Level 4 (round-2 plan 2026-09-26-2055 DEC-FB2-4) refines only once a
 * texel of level 3 spans more than the error target; level 5 (round-4 plan
 * 2026-09-28-2105 DEC-GL4-3) once a level-4 texel does.
 */
function tileRequestsByLevel() {
  const levels = [0, 0, 0, 0, 0, 0];
  const seen = new Set();
  for (const e of performance.getEntriesByType("resource")) {
    const m = /\/blue-marble-4326\/(\d+)\//.exec(e.name);
    if (!m || seen.has(e.name)) continue;
    seen.add(e.name);
    const level = Number(m[1]);
    levels[level] = (levels[level] ?? 0) + 1;
  }
  return levels;
}

async function start() {
  // The default log keeps 250 entries: fewer than the committed pyramid
  // (2,730 tiles with level 5).
  performance.setResourceTimingBufferSize(4000);
  // The stencil fill (round-6 plan G6-1) needs a stencil buffer, only with
  // a relief; three creates none by default.
  const fillAtStart = (() => {
    const p0 = readHashParams();
    return p0.relief === 1 && p0.bandFill === 1;
  })();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    stencil: fillAtStart,
  });
  // Phase 1's exposure (§7.3): Neutral tone mapping (the look-dev
  // default), no ambient light, a black sky; the sun at the surface's own
  // intensity (5 since round 4, DEC-GL4-1; π in phase 1).
  renderer.toneMapping = THREE.NeutralToneMapping;
  // The frame clears once, then draws the sky pass, then the Earth over it.
  renderer.autoClear = false;
  const sky = createGlobeSky();
  const sunWorld = new THREE.Vector3();
  const earthDirection = new THREE.Vector3();
  const celestial = new THREE.Quaternion();
  let siderealAngleRad = 0;
  const device = reportDevice(renderer);
  const scene = new THREE.Scene();
  const radius = WGS84_ELLIPSOID.radius.x;
  const camera = new THREE.PerspectiveCamera(
    PARAMS.fovY.fallback,
    1,
    radius * 0.01,
    radius * 20,
  );
  let distance = radius * 3;
  let fittedSize = "";
  /** When the frame loop last ran (performance.now()), for the smokes. */
  let frameAt = 0;
  const terrainResolution = new THREE.Vector2();
  const startParams = readHashParams();
  // A page with a relief compiles the band into the globe's shader; the
  // plain globe draws the program from before the relief.
  const globe = createGlobeSurface(undefined, {
    band: startParams.relief === 1,
    // A globe that fills the relief's gaps never discards (round-6 plan
    // G6-1): its program keeps the GPU's early stencil test.
    fill: fillAtStart,
  });
  useSurfaceDefaults(globe);
  // The world frame (F2 plan F2a, M3): one matrix on globe.group, from ECEF
  // to the target's local frame (x east, y up, the origin on the ground),
  // or the identity before any target. Every camera pose is written and
  // read in ECEF through it (`/globe/globe-frame.js`), never by assuming
  // world = ECEF.
  const worldFrame = { matrix: new THREE.Matrix4(), target: null };
  globe.group.matrixAutoUpdate = false;
  const ecefCamera = () => ecefPoseOf(camera, worldFrame.matrix);
  const placeCameraEcef = (position, quaternion) =>
    applyEcefPose(camera, { position, quaternion }, worldFrame.matrix);
  /** Set once the controls exist: they hold world-space drag state. */
  let onFrameChange = () => {};
  /** Moves the world frame to `target` (null: ECEF), the view unchanged. */
  const setFrameTarget = (target) => {
    const next = params.worldFrame === 1 && target ? target : null;
    if (
      next?.lat === worldFrame.target?.lat &&
      next?.lng === worldFrame.target?.lng
    ) {
      return;
    }
    const before = ecefCamera();
    if (next) worldFromEcefAt(globe.tiles.ellipsoid, next, worldFrame.matrix);
    else worldFrame.matrix.identity();
    worldFrame.target = next ? { lat: next.lat, lng: next.lng } : null;
    globe.group.matrix.copy(worldFrame.matrix);
    globe.group.matrixWorldNeedsUpdate = true;
    globe.group.updateMatrixWorld(true);
    applyEcefPose(camera, before, worldFrame.matrix);
    onFrameChange();
    debugLog.log("frame", worldFrame.target);
  };
  /**
   * Moves the frame under the camera once the user has flown it too far
   * from the frame's origin (volume-cloud plan §14, `frameRecentreTarget`):
   * a frame left on the link's target while the owner flew 244 km stood
   * 4.7 km off the curved ground there, and the cloud deck, flat in the
   * frame, floated above the camera (2026-10-06). The view is unchanged;
   * the volume's noise is anchored to the ground, so its clouds stay put.
   */
  const recentreFrame = () => {
    if (worldFrame.target === null) return;
    const ellipsoid = globe.tiles.ellipsoid;
    const c = ellipsoid.getPositionToCartographic(ecefCamera().position, {});
    const next = frameRecentreTarget(
      ellipsoid,
      worldFrame.target,
      { lat: c.lat / DEG, lng: c.lon / DEG },
      c.height,
    );
    if (next) setFrameTarget(next);
  };
  /** The Earth's centre in the world (the origin of ECEF, through the frame). */
  const earthCentre = new THREE.Vector3();
  const earthCentreWorld = () =>
    earthCentre.setFromMatrixPosition(globe.group.matrixWorld);
  /** A camera for the orbit poses, which are written in ECEF. */
  const ecefScratch = new THREE.PerspectiveCamera();
  const { radius: radii } = globe.tiles.ellipsoid;
  const atmosphere = createGlobeAtmosphere(renderer, [
    radii.x,
    radii.y,
    radii.z,
  ]);
  // The ground sky (F2b): the framework's sky below the hand-over edge, in
  // the framework's units; its eased exposure is the globe's sun intensity.
  const groundSky = createGlobeGroundSky(renderer);
  /**
   * This frame's hand-over: the ground sky's weight and the sun's eased
   * scale in the scene (the globe's sun intensity).
   */
  let skyHandOver = { weight: 0, exposure: Number.NaN };
  /** The view direction the cloud volume centres its disc along (§15). */
  const volumeView = new THREE.Vector3();
  /** The observer's height over the ellipsoid's image (km), this frame. */
  let observerKm = Number.POSITIVE_INFINITY;
  let shellThickness = null;
  scene.add(globe.group);
  // The relief (F1): the library's terrain tiles wearing the globe's look,
  // in the globe's group, in place of the generated tiles. Created once, on
  // the page's first relief=1; its heights are exaggerated by altitude.
  // The synthetic heights record each height tile requested: the smokes
  // count a return into the band's fetches (DEC-N1).
  const syntheticHeights =
    startParams.relief === 1 && startParams.reliefHeights === "synthetic"
      ? installSyntheticHeights()
      : null;
  // The real heights' source is loaded only for the relief: the boot graph
  // stays free of the Osm library (build-lookdev.test.mjs).
  const terrarium =
    startParams.relief === 1 && startParams.reliefHeights !== "synthetic"
      ? await import("/osm-lib/elevation/terrarium.js")
      : null;
  const terrain =
    startParams.relief === 1
      ? createGlobeTerrain({
          url: terrarium
            ? terrarium.TERRARIUM_URL_TEMPLATE
            : SYNTHETIC_HEIGHTS_URL,
          // Its own overlay of the same imagery: an overlay's image cache is
          // shared by its users, so releasing one carrier freed imagery the
          // other was still composing.
          imagery: createGlobeImagery(),
          template: globe.template,
          heightScale: 1,
          lazyHeightScale: startParams.lazyE === 1,
          keepHeightsBytes: startParams.keepHeightsMiB * 2 ** 20,
        })
      : null;
  if (terrain) globe.group.add(terrain.tiles.group);
  // The stencil fill (round-6 plan G6-1): the relief draws first and marks
  // its pixels; the globe fills every pixel without a mark.
  const bandFill = Boolean(terrain) && fillAtStart;
  if (bandFill) {
    terrain.tiles.group.renderOrder = -1;
    const roles = (tiles, role) =>
      tiles.addEventListener("load-model", ({ scene: model }) => {
        model.traverse((o) => {
          if (o.isMesh) role(o.material);
        });
      });
    roles(terrain.tiles, asStencilWriter);
    roles(globe.tiles, asStencilFill);
  }
  // The cloud volume (C2; globe-cloud-volume.js): the ground sky's slab, its
  // clouds from the globe's map, ending at the relief's depth; its shadow
  // (C3) patches the relief before the haze does.
  const cloudVolume =
    terrain && groundSky.supported
      ? createGlobeCloudVolume(renderer, {
          atmosphere: groundSky.atmosphere,
          skyScene: groundSky.scene,
          surfaceUniforms: globe.surfaceUniforms,
        })
      : null;
  if (cloudVolume) cloudVolume.patchShadow(terrain.tiles);
  // The haze (F2b; globe-haze.js): one fog for the whole page, the relief's
  // tiles patched last, after their own hooks and the stencil writer.
  const haze = createGlobeHaze(scene, {
    visibilityKm: groundSky.atmosphere?.visibilityKm ?? 60,
  });
  if (terrain) haze.patch(terrain.tiles);
  // The relief's detail colour, loaded only for the relief (its worker reads
  // the Osm library, which the boot graph must not).
  const detailRegion = terrain
    ? (await import("./globe-detail-region.js")).createDetailRegion({
        terrain,
        urlTemplate: terrarium
          ? terrarium.TERRARIUM_URL_TEMPLATE
          : SYNTHETIC_HEIGHTS_URL,
      })
    : null;
  /** The drawn ground under the camera (m, null with no relief there). */
  let groundUnderCameraM = null;
  /** Frames on which the clearance raised the camera. */
  let clearanceLifts = 0;
  /**
   * The share on the frame before, and the bytes released when a carrier
   * left the frame (review 2026-10-03-1835 major 4: outside the band the
   * inactive carrier's tiles are unloaded, not only left undrawn).
   */
  const released = { globe: 0, relief: 0 };
  /**
   * When each carrier left the band (performance.now(), null while it has
   * pixels) and whether its cache has been released since.
   */
  const outOfBand = {
    globe: { since: null, done: false, last: null },
    relief: { since: null, done: false, last: null },
  };
  /** The relief's share of the pixels this frame (the band's cross-fade). */
  let bandShare = terrain ? 1 : 0;
  /** The tiles the surface is mostly drawn with now: the relief's or the globe's. */
  const surfaceTiles = () =>
    terrain && bandShare >= 0.5 ? terrain.tiles : globe.tiles;
  const credits = creditsFor(globe.activeSources());
  renderCredits(
    credits,
    !terrain
      ? null
      : terrarium
        ? terrarium.TERRARIUM_ATTRIBUTION
        : "Heights: synthetic, generated in the page.",
  );
  const status = statusView();
  const flight = introFlight(globe.tiles.ellipsoid, {
    sunEcef: () => globe.surfaceUniforms.uSunEcef.value,
    fitDistance: () => distance,
    zoomOutM: () => zoomOutM(),
  });
  // Set once the pin exists (below); a touch before that has no flight.
  let pin = null;
  /** A view held by the `pitchView` test hook: the controls do not run. */
  let heldView = false;
  /** While the plate measures the atmosphere's cost: "on", "off" or null. */
  let costMode = null;
  /**
   * The field of view easing back to fovY ({ from, to, at, ms }), and the
   * last such ease, kept for the `fovReturnAt` test hook.
   */
  let fovReturn = null;
  let lastFovReturn = null;
  /** The ease's field of view `elapsedMs` after it began. */
  const fovAt = (r, elapsedMs) =>
    r.ms > 0 && elapsedMs < r.ms
      ? r.from + (r.to - r.from) * smoothstep(elapsedMs / r.ms)
      : r.to;
  /** One frame of the ease back to fovY (FOV_RETURN_MS), if one is due. */
  const returnFov = (now) => {
    if (camera.fov === params.fovY) {
      fovReturn = null;
      return;
    }
    if (!fovReturn) {
      fovReturn = {
        from: camera.fov,
        to: params.fovY,
        at: now,
        ms: FOV_RETURN_MS,
      };
      lastFovReturn = fovReturn;
    }
    fovReturn.to = params.fovY;
    camera.fov = fovAt(fovReturn, now - fovReturn.at);
    fovReturn.lastFrameAt = now;
    camera.updateProjectionMatrix();
    if (camera.fov === params.fovY) fovReturn = null;
  };
  // The nearest drawn ground and the highest drawn peak for the clip planes
  // (F2a, M4): the relief's sampler at the camera's ground point and on a
  // ring of eight points as far out as the camera stands above that ground
  // (ground farther out is farther than the ground below anyway), the
  // distance to the nearest of them (`reliefClearanceM`: a ridge beside
  // the camera counts its horizontal distance however high it stands), and
  // the highest real peak (8,850 m) times E. The first rule, the height
  // above the HIGHEST ground nearby, floored the near plane at 1 m under a
  // ridge (F2a's browser run, 2026-10-05).
  const planeLocal = new THREE.Vector3();
  const RING = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
  /** The planes' last clearance (m), for the state; null without. */
  let planeClearanceM = null;
  let planeSamples = null;
  const reliefPlanes = () => {
    if (!terrain || bandShare <= 0 || params.reliefPlanes === 0) return {};
    const ellipsoid = globe.tiles.ellipsoid;
    globe.tiles.group.worldToLocal(planeLocal.copy(camera.position));
    const c = ellipsoid.getPositionToCartographic(planeLocal, {});
    const altitude = ellipsoid.getPositionElevation(planeLocal);
    const below = terrain.plugin.sampleCartographicElevation(c.lat, c.lon);
    const ringM = Math.max(10, altitude - Math.max(0, below ?? 0));
    const samples = [{ distanceM: 0, groundM: below }];
    for (const a of RING) {
      samples.push({
        distanceM: ringM,
        groundM: terrain.plugin.sampleCartographicElevation(
          c.lat + (ringM * Math.cos(a)) / radius,
          c.lon +
            (ringM * Math.sin(a)) / (radius * Math.max(Math.cos(c.lat), 0.01)),
        ),
      });
    }
    const clearanceM = reliefClearanceM(altitude, samples);
    planeClearanceM = Number.isFinite(clearanceM) ? clearanceM : null;
    planeSamples = {
      altitude,
      below,
      ringM,
      ring: samples.slice(1).map((x) => x.groundM),
    };
    return {
      ...(planeClearanceM === null ? {} : { clearanceM }),
      peakM: RELIEF_PEAK_M * terrain.plugin.heightScale,
    };
  };
  const controls = cameraControls(
    scene,
    camera,
    globe,
    () => {
      flight.yieldToUser(performance.now());
      pin?.cameraTaken();
    },
    reliefPlanes,
  );
  // A frame change moves the world under the controls' drag state.
  onFrameChange = () => controls.release();
  /**
   * How far the controls zoom out and where the fly-in starts (review
   * 2026-10-01-2124 Major 1): the largest of `maxKm`, the library's own
   * limit at fovY and twice the fit, so a portrait phone never gets less
   * than the library allows. Asked on every call, so a resize or a new
   * fovY re-applies it.
   */
  const zoomOutM = () =>
    globeZoomOutLimitM({
      maxM: params.maxKm * 1000,
      radiusM: radius,
      fovYDeg: params.fovY,
      aspect: camera.aspect,
      fitM: distance,
    });
  controls.limit(zoomOutM);
  /** The replay button or a new target or timing: the intro again. */
  const giveBackToIntro = () => {
    setFrameTarget(params.url);
    flight.restart(performance.now(), params);
    controls.release();
    pin?.cameraTaken();
  };
  let params = readHashParams();
  let appliedHash = location.hash.slice(1);
  /** The globe's one clock; restarted only when its setting changes. */
  const startClock = () =>
    startGlobeClock(params.clock, {
      epochMs: Date.now(),
      monoMs: performance.now(),
    });
  let clock = startClock();
  const sceneMs = () => clock.timeAt(performance.now());
  /** When the frame last refreshed the hour label (performance.now()). */
  let clockShownAt = -Infinity;
  /**
   * Everything but the intro's target and timing, applied at once. The
   * field of view and the pixel ratio refit the camera and resize the
   * drawing buffer, so they are touched only when they change.
   */
  const applyLive = () => {
    const u = globe.surfaceUniforms;
    u.uNightGain.value = params.nightGain;
    u.uWaterRoughness.value = params.waterRoughness;
    u.uCloudOpacity.value = params.cloudOpacity;
    u.uGrade.value = params.grade;
    u.uCloudRelief.value = params.cloudRelief;
    u.uTwilight.value = params.twilight;
    u.uSkyFloor.value = params.skyFloor;
    sky.setStarGlow(params.starGlow);
    globe.sun.intensity = params.sunIntensity;
    sky.setLook({ sunDiameterDeg: params.sunSize, glow: params.sunGlow });
    globe.tiles.errorTarget = params.errorTarget;
    globe.tiles.lruCache.maxBytesSize = params.cacheMiB * 2 ** 20;
    globe.tiles.lruCache.minBytesSize =
      params.cacheMiB * CACHE_FLOOR_RATIO * 2 ** 20;
    const ratio = Math.min(window.devicePixelRatio, params.pixelRatio);
    if (camera.fov !== params.fovY || renderer.getPixelRatio() !== ratio) {
      camera.fov = params.fovY;
      renderer.setPixelRatio(ratio);
      fittedSize = ""; // refit on the next frame
    }
    applyFactors(params);
    atmosphere.setLook({
      steps: params.atmoSteps,
      strength: params.atmoStrength,
      thickness: params.atmoThickness,
    });
    sky.setStarLook({
      magLimit: params.starMag,
      gain: params.starGain,
      milkyWay: params.milkyWay,
      pixelRatio: renderer.getPixelRatio(),
      visible: params.stars !== 0,
    });
  };
  /**
   * The factors the frame-hitch recorder varies (§4.3), from the hash or
   * from one of its cells: the controls' height adjustment, the relief's
   * cache and queues, and (from a cell) the pixel-ratio cap.
   */
  const applyFactors = (f) => {
    controls.setAdjustHeight(f.adjustHeight === 1);
    if (terrain) {
      const cache = terrain.tiles.lruCache;
      cache.maxBytesSize = f.reliefCacheMiB * 2 ** 20;
      cache.minBytesSize = f.reliefCacheMiB * RELIEF_FLOOR_RATIO * 2 ** 20;
      terrain.tiles.parseQueue.maxJobs = f.parseJobs;
      terrain.tiles.downloadQueue.maxJobsPerOrigin = f.downloadsPerOrigin;
    }
  };
  /** Reads the hash and applies it; a new target or timing restarts. */
  const onHash = () => {
    const next = readHashParams();
    const restart = flightKey(next) !== flightKey(params);
    const clockChanged = !sameGlobeClockSetting(next.clock, params.clock);
    params = next;
    if (clockChanged) clock = startClock();
    if (restart) giveBackToIntro();
    applyLive();
    syncPanel();
    appliedHash = location.hash.slice(1);
  };
  /**
   * Everything the clock drives, at its instant: the sun (it moves 0.25° a
   * minute) and the clouds' drift. Returns the instant.
   */
  const sunNow = () => {
    const mono = performance.now();
    const ms = clock.timeAt(mono);
    globe.setSun(
      sunDirectionEcef(globe.tiles.ellipsoid, solarPosition(ms, 0, 0)),
    );
    // The drift runs on the clock's DRIFT time: the scene's time up to real
    // time, real time above it, so a fast clock does not strobe the clouds.
    globe.surfaceUniforms.uCloudLonOffset.value = cloudLonOffsetRad(
      clock.driftTimeAt(mono),
      params.cloudDrift,
    );
    siderealAngleRad = greenwichSiderealAngleRad(ms);
    return ms;
  };
  const panel = bindPanel(
    () => params,
    () => onHash(),
    sceneMs,
    () => clock.scale,
  );
  const syncPanel = panel.sync;
  /**
   * The distance readout (round-4 plan 2026-09-28-2105 DEC-GL4-5): the
   * camera's altitude above the ellipsoid, and while the pin's dive is on
   * its way or holding over the target, the straight-line distance to the
   * target's point on the ellipsoid. Written at most 4 times a second and
   * only when the text changes (`/globe/globe-readout.js`).
   */
  const readout = readoutThrottle((text) => {
    readoutLine.textContent = text;
  });
  const cameraLocal = new THREE.Vector3();
  const targetLocal = new THREE.Vector3();
  let readoutText = "";
  const readoutNow = () => {
    const ellipsoid = globe.tiles.ellipsoid;
    globe.tiles.group.worldToLocal(cameraLocal.copy(camera.position));
    const { phase, target } = flight.state();
    let targetDistanceM = null;
    if ((phase === "diving" || phase === "landed") && target) {
      ellipsoid.getCartographicToPosition(
        target.lat * DEG,
        target.lng * DEG,
        0,
        targetLocal,
      );
      targetDistanceM = cameraLocal.distanceTo(targetLocal);
    }
    return globeReadoutText({
      altitudeM: ellipsoid.getPositionElevation(cameraLocal),
      targetDistanceM,
    });
  };
  // The world frame at the at= target from load (F2a), else ECEF.
  setFrameTarget(params.url);
  flight.restart(performance.now(), params);
  applyLive();
  syncPanel();
  // The permission rule (round-5 plan §3.1): a position only where it is
  // already granted, never a prompt at load (the pin asks); otherwise the
  // intro does not wait for one.
  geolocationPermissionState()
    .then(async (state) => {
      if (state !== "granted") {
        flight.noFixComing();
        return;
      }
      const outcome = await locateOnce(navigator.geolocation, {
        timeoutMs: LOCATE_TIMEOUT_MS,
      });
      if (outcome.kind === "located") {
        flight.setFix(
          { lat: outcome.fix.lat, lng: outcome.fix.lng },
          performance.now(),
        );
      } else {
        flight.noFixComing();
      }
    })
    .catch(() => flight.noFixComing());
  window.addEventListener("hashchange", onHash);
  replayButton.addEventListener("click", giveBackToIntro);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pin?.hidden();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) pin?.returned();
  });
  /** The relief's height law as the hash sets it (`exaggerationAt`). */
  const heightLaw = () =>
    params.reliefGround > 0
      ? {
          near: params.reliefNear,
          ground: Math.min(params.reliefGround, params.reliefNear),
        }
      : { near: params.reliefNear };
  /**
   * The least altitude over `target` (the clearance rule, F1): its ground
   * from a ray down onto the drawn relief, exaggerated as at the hand-over
   * altitude, plus the clearance; 0 without the relief or a loaded tile.
   */
  const diveFloorM = (target) => {
    if (!terrain) return 0;
    const ground = terrain.plugin.sampleCartographicElevation(
      target.lat * DEG,
      target.lng * DEG,
    );
    if (ground === null) return 0;
    const heightM = ground / Math.max(terrain.plugin.heightScale, 1);
    const e = exaggerationAt(params.handOverKm * 1000, heightLaw());
    return minimumAltitudeM(heightM, e, GLOBE_FLIGHT.clearanceM);
  };
  pin = bindPin({
    diveFloorM,
    ecefCamera,
    setFrameTarget,
    // The relief's detail colour over the target's region, built while
    // the dive runs.
    onLocated: (target, p) => {
      detailRegion?.load(target, { detail: p.detail }).catch((error) => {
        console.error(`The relief's detail could not load: ${error}`);
      });
    },
    flight,
    controls,
    camera,
    getParams: () => params,
    sceneMs,
    navigate: (url) => location.assign(url),
  });
  // A link that names a place (`at=`) warms the city's data from load (the
  // city plan K0), not only from the pin's press.
  if (params.url && params.cityWarm === 1) pin.warm(params.url);

  /** The frame-hitch recorder (`#perf=1` only, `globe-perf.js`), or null. */
  let perf = null;
  /** The Debug panel (`globe-debug.js`), created after the first frame's setup. */
  let debug = null;
  /** The band share last written to the debug log (steps of 0.1). */
  let loggedShare = null;
  /** The altitude's share before the gate, and the gate's last frame. */
  let bandTarget = 0;
  let lastGateAt = null;
  /** Whether the gate held the share back on the frame before. */
  let bandHeld = false;
  /**
   * For the fill smoke: the relief's tiles hidden, as if none were loaded,
   * so every pixel must come from the globe's fill (round-6 plan G6-1).
   */
  let reliefHidden = false;
  /** For the cloud smoke: the shell hidden, the ground under it alone. */
  let cloudShellHidden = false;
  /** Whether the relief's view is refined: nothing of it loading or queued. */
  const reliefSettled = () =>
    terrain.tiles.loadProgress === 1 &&
    !terrain.tiles.downloadQueue.running &&
    !terrain.tiles.parseQueue.running &&
    !terrain.tiles.processNodeQueue.running;
  /** A carrier's coarsest tiles, which a drain keeps (round-6 plan G6-1). */
  const keepCoarsest = (tile) => (tile?.internal?.depth ?? Infinity) <= 1;
  /**
   * What a drain keeps of `tiles`: its coarsest tiles, and any tile its last
   * update used (with the stencil fill the globe is updated while it fills,
   * and draining what it draws would only reload it).
   */
  const keepFor = (tiles) => (tile) =>
    keepCoarsest(tile) ||
    (tile?.traversal?.used === true &&
      tile.traversal.lastFrameVisited === tiles.frameCount);
  /**
   * The frame's recorder hooks, fanned out to the frame-hitch recorder and
   * the Debug panel; the rare events also go to the debug log.
   */
  const hooks = {
    frameStart(now) {
      perf?.frameStart(now);
      debug?.frameStart(now);
    },
    frameEnd(now) {
      perf?.frameEnd(now);
      debug?.frameEnd(now);
    },
    mark(kind, detail = null) {
      perf?.mark(kind);
      debug?.mark(kind);
      if (
        detail !== undefined &&
        !kind.endsWith(".mixed") &&
        !kind.startsWith("drain.")
      ) {
        debugLog.log(kind, detail);
      }
    },
    eStep(ms, e) {
      perf?.eStep(ms);
      debug?.mark("e.step");
      debugLog.log("e.step", { ms: Math.round(ms * 10) / 10, e });
    },
  };
  /** An exaggeration the recorder holds in place of the altitude's, or null. */
  let eOverride = null;
  /** The band's share on the frame before (the recorder's edge mark). */
  let lastShare = bandShare;

  const frame = () => {
    hooks.frameStart(performance.now());
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Both sides: a phone's URL bar changes only the height.
    if (`${w}x${h}` !== fittedSize) {
      fittedSize = `${w}x${h}`;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // At the lab's field of view, not the camera's: the fly-in varies
      // the camera's on the way.
      distance = orbitDistanceToFit({
        fovYRad: params.fovY * DEG,
        aspect: camera.aspect,
        margin: FIT_MARGIN,
        radius,
      });
    }
    sunNow();
    const now = performance.now();
    frameAt = now;
    if (perf?.drives()) {
      // The recorder's paths (§4.2) place the camera themselves.
      perf.drive(now);
    } else if (flight.drives) {
      const step = flight.pose(now);
      if (step.pose) {
        applyOrbitPose(ecefScratch, step.pose, step.distanceM ?? distance);
        placeCameraEcef(ecefScratch.position, ecefScratch.quaternion);
        flight.cameraPlaced(ecefScratch.position.length());
        if (step.fovDeg !== undefined && camera.fov !== step.fovDeg) {
          camera.fov = step.fovDeg;
          camera.updateProjectionMatrix();
        }
        fovReturn = null;
      } else {
        // The dive sets no field of view: one the fly-in left eases back.
        placeCameraEcef(step.position, step.quaternion);
        returnFov(now);
      }
      camera.updateMatrixWorld();
      controls.followIntro();
    } else {
      // The user took the camera, perhaps mid-fly-in: ease back to fovY.
      returnFov(now);
      controls.pickFrom(surfaceTiles().group);
      if (!heldView) controls.update();
      recentreFrame();
    }
    pin.frame();
    if (terrain) {
      // The altitude band: each carrier is drawn, and updated (so fetched),
      // only where it has pixels to draw.
      camera.updateMatrixWorld();
      const altitudeM = Math.max(
        0,
        globe.tiles.ellipsoid.getPositionElevation(
          globe.tiles.group.worldToLocal(camera.position.clone()),
        ),
      );
      const highM = params.bandHigh * 1000;
      const targetShare =
        params.bandShare ??
        carrierShareAt(altitudeM, {
          highM,
          lowM: Math.min(params.bandLow * 1000, highM - 1),
        });
      if (params.bandShare !== null || params.bandGate === 0) {
        bandShare = targetShare;
      } else {
        // Each carrier's readiness from its last update (round-6 plan G6-1).
        // The relief starts taking pixels only once its view is refined
        // (round-6 plan G6-1, owner 2026-10-04: no flash from the globe's
        // sharp imagery to the relief's coarse first tiles); once it has
        // pixels it keeps them while its top tiles are loaded, so a pan at a
        // low altitude never hands the frame back and forth.
        const reliefReady =
          topLevelReady(terrain.tiles) &&
          (bandShare > 0 || params.bandSharp === 0 || reliefSettled());
        const globeReady = topLevelReady(globe.tiles);
        const held = !reliefReady || !globeReady;
        if (held !== bandHeld) {
          bandHeld = held;
          debugLog.log(held ? "band.hold" : "band.go", {
            reliefReady,
            globeReady,
            target: targetShare,
            drawn: bandShare,
          });
        }
        bandShare = nextDrawnShare({
          // The first gated frame starts on the globe: it draws from orbit,
          // and the relief takes over once it is ready.
          drawn: lastGateAt === null ? 0 : bandShare,
          target: targetShare,
          reliefReady,
          globeReady,
          dtMs: lastGateAt === null ? 0 : Math.min(now - lastGateAt, 250),
        });
      }
      lastGateAt = now;
      bandTarget = targetShare;
      globe.surfaceUniforms.uCarrierShare.value = bandShare;
      if (bandShare > 0 !== lastShare > 0 || bandShare < 1 !== lastShare < 1) {
        hooks.mark("band.edge", { share: bandShare, altKm: altitudeM / 1000 });
      }
      if (bandShare > 0 && bandShare < 1) hooks.mark("band.mixed");
      const shareStep = Math.round(bandShare * 10) / 10;
      if (shareStep !== loggedShare) {
        loggedShare = shareStep;
        debugLog.log("band.share", {
          share: shareStep,
          altKm: altitudeM / 1000,
        });
      }
      lastShare = bandShare;
      // A carrier out of the band for `bandReleaseMs` has its cache
      // released; a return before then cancels it. Not while frozen: the
      // smokes step the share over the same tiles.
      const frozen = params.bandFreeze === 1;
      for (const [key, out, cache, keep] of [
        ["globe", bandShare >= 1, globe.tiles.lruCache, keepFor(globe.tiles)],
        [
          "relief",
          bandShare <= 0,
          terrain.tiles.lruCache,
          keepFor(terrain.tiles),
        ],
      ]) {
        const o = outOfBand[key];
        if (!out || frozen) {
          if (!out) o.done = false;
          o.since = null;
        } else if (!o.done) {
          o.since ??= now;
          if (now - o.since >= params.bandReleaseMs) {
            // For the smokes: when the carrier left, when its release
            // started and ended, and its dispose cost per frame.
            if (o.last?.leftAt !== o.since) {
              o.last = {
                leftAt: o.since,
                releasedAt: now,
                drainedAt: null,
                frames: 0,
                maxPerFrame: 0,
                releaseMs: 0,
                worstFrameMs: 0,
                bytes: 0,
              };
              hooks.mark(`release.${key}`, { altKm: altitudeM / 1000 });
            }
            const t0 = performance.now();
            const items = cache.itemList.length;
            const step = params.bandDrainTiles;
            // The drain keeps the carrier's coarsest tiles (depth 1, the
            // root's children): cheap, and what lets it draw again at once
            // when the view returns (round-6 plan G6-1, the zoom-out holes).
            let left = 0;
            let bytes;
            if (step === 0) {
              bytes = releaseTileCache(cache);
            } else {
              const drained = drainTileCache(cache, step, keep);
              bytes = drained.freedBytes;
              left = drained.left;
            }
            const ms = performance.now() - t0;
            const l = o.last;
            l.frames++;
            l.maxPerFrame = Math.max(
              l.maxPerFrame,
              items - cache.itemList.length,
            );
            l.releaseMs += ms;
            l.worstFrameMs = Math.max(l.worstFrameMs, ms);
            l.bytes += bytes;
            released[key] += bytes;
            hooks.mark(`drain.${key}`);
            if (left === 0) {
              o.done = true;
              l.drainedAt = now;
              debugLog.log(`drained.${key}`, {
                frames: l.frames,
                mib: l.bytes / 2 ** 20,
              });
            }
          }
        }
      }
      // The clearance every frame (one-scene plan §3.4; review 2026-10-03-1835
      // major 1): wherever the relief draws, the camera never comes closer
      // to the drawn ground under it than the clearance, whoever owns the
      // camera (the dive, the hold or the controls).
      if (bandShare > 0) {
        const at = globe.tiles.ellipsoid.getPositionToCartographic(
          globe.tiles.group.worldToLocal(camera.position.clone()),
          {},
        );
        groundUnderCameraM = terrain.plugin.sampleCartographicElevation(
          at.lat,
          at.lon,
        );
        const cleared = clearedAltitudeM(
          altitudeM,
          groundUnderCameraM,
          GLOBE_FLIGHT.clearanceM,
        );
        if (cleared > altitudeM) {
          const lifted = ecefCamera();
          const r = lifted.position.length();
          lifted.position.multiplyScalar((r + cleared - altitudeM) / r);
          placeCameraEcef(lifted.position, lifted.quaternion);
          clearanceLifts += 1;
        }
      }
      // With the fill the globe always draws (only where the relief left a
      // pixel) and is always updated, coarse while the relief has every
      // pixel, so it keeps to its top tiles.
      globe.tiles.group.visible = bandFill || bandShare < 1;
      if (bandFill) {
        globe.tiles.errorTarget =
          bandShare >= 1 && bandTarget >= 1
            ? params.bandFillErrorTarget
            : params.errorTarget;
      }
      // A carrier is updated (so loads) where it draws or where the
      // altitude wants it to: the gate waits for it to be ready.
      if ((bandFill || bandShare < 1 || bandTarget < 1) && !frozen) {
        globe.update(camera, renderer);
      }
      terrain.tiles.group.visible = bandShare > 0 && !reliefHidden;
      if ((bandShare > 0 || bandTarget > 0) && !frozen) {
        terrain.tiles.setCamera(camera);
        renderer.getDrawingBufferSize(terrainResolution);
        terrain.tiles.setResolution(
          camera,
          terrainResolution.x,
          terrainResolution.y,
        );
        // An E step re-walks the relief's tile tree (frame-hitch plan H1):
        // the assignment is timed for the recorder.
        const e = eOverride ?? exaggerationAt(altitudeM, heightLaw());
        if (e !== terrain.plugin.heightScale) {
          const t0 = performance.now();
          terrain.plugin.heightScale = e;
          hooks.eStep(performance.now() - t0, e);
        }
        terrain.tiles.update();
      }
    } else {
      globe.update(camera, renderer);
    }
    // The cloud shell rides the relief's exaggeration, as the relief is
    // raised (round-6 plan G6-2, DEC-G6-3: 3 km x E; E is 1 without one).
    globe.cloudShell.setHeightM(
      params.cloudShellKm * 1000 * (terrain?.plugin.heightScale ?? 1),
    );
    // The clouds move onto the shell as the relief takes the pixels, so the
    // orbit keeps the approved painted look exactly, and the relief, where
    // the paint turned it black and white, gets the shell. Measured
    // 2026-10-04: from orbit the shell read 25-35 levels (summed) darker than
    // the paint, because each draw is tone-mapped and then blended in
    // display space; the paint mixes before the tone mapping.
    const shellShare = params.cloudShell === 1 && terrain ? bandShare : 0;
    globe.setCloudShellShare(shellShare);
    if (cloudShellHidden) globe.cloudShell.mesh.visible = false;
    // The shell's soft shadow, unless the volume's is chosen (C3).
    globe.surfaceUniforms.uCloudShadow.value =
      params.cloudShadowFrom === 1 && cloudVolume
        ? 0
        : params.cloudShadow * shellShare;
    status.update(globe.state());
    readoutText = readoutNow();
    readout.offer(readoutText, performance.now());
    // A running clock moves the hour: its label follows, once a second.
    const mono = performance.now();
    if (clock.scale !== 0 && mono - clockShownAt >= 1000) {
      clockShownAt = mono;
      panel.showClock();
    }
    // The clip planes where the camera now is, after the clearance's lift.
    controls.fitPlanes();
    // The sky hand-over (F2b): the observer's height over the ellipsoid,
    // the ground sky's weight and its eased exposure, which also scales the
    // globe's sun; the space pass's shell thins on the way down.
    observerKm = observerAltitudeKm(
      ecefCamera().position.toArray(),
      [radii.x, radii.y, radii.z],
      EARTH_ATMOSPHERE.groundRadiusKm,
    );
    sunWorld
      .copy(globe.sun.position)
      .transformDirection(globe.group.matrixWorld);
    skyHandOver =
      params.groundSky === 1 && params.sky !== 0
        ? groundSky.update({
            altitudeKm: observerKm,
            sunWorld,
            framed: worldFrame.target !== null,
            edgeKm: params.skyEdgeKm,
            widthKm: Math.min(params.skyWidthKm, params.skyEdgeKm),
            stepPct: params.skyStepPct,
            spaceExposure: params.sunIntensity,
          })
        : { weight: 0, exposure: params.sunIntensity };
    // The haze follows the ground sky: its state after each read, its
    // strength by the weight.
    if (groundSky.state().lastStage === "read") haze.sync(groundSky.atmosphere);
    haze.setWeight(skyHandOver.weight, params.hazeScale);
    // The cloud volume (C2): its share by altitude, its disc, and the
    // shell's hole of the same size (variant 1), so the clouds are drawn
    // once at every altitude.
    if (cloudVolume) {
      cloudVolume.setEnabled(params.cloudVolume > 0);
      cloudVolume.setShadow(params.cloudShadowFrom === 1);
      const volume = cloudVolume.update({
        altitudeKm: Math.max(0, observerKm),
        target: worldFrame.target,
        radiusKm: params.cloudVolumeKm,
        ceilingKm: params.cloudVolumeCeilingKm,
        fadeKm: params.cloudVolumeFadeKm,
        cover: params.cloudVolumeCover,
        shellHeightM: globe.cloudShell.heightM(),
        // The disc where the view meets the deck (§15); variant 1 keeps it
        // on the camera, where the shell's hole is.
        view: {
          position: camera.position.toArray(),
          direction: camera.getWorldDirection(volumeView).toArray(),
        },
        maxAheadM:
          params.cloudVolume === 1 ? 0 : CLOUD_VOLUME.maxAheadKm * 1000,
      });
      globe.cloudShell.setHole(
        params.cloudVolume === 1 && volume.radiusM > 0
          ? {
              radiusM: volume.radiusM,
              aboveCameraM: globe.cloudShell.heightM() - observerKm * 1000,
            }
          : null,
      );
    }
    globe.sun.intensity = skyHandOver.exposure;
    const thickness =
      params.atmoRamp === 1
        ? shellThicknessAt(Math.max(0, observerKm), params.atmoThickness)
        : params.atmoThickness;
    if (thickness !== shellThickness) {
      shellThickness = thickness;
      atmosphere.setLook({ thickness });
    }
    // The sky pass first, from the direction the Earth is lit from (the
    // light's position in the surface's group, turned into the world), with
    // no depth, so the Earth drawn next covers it.
    renderer.setClearColor(params.holeColor === 1 ? 0xff00ff : 0x000000);
    renderer.clear();
    if (params.sky !== 0) {
      sky.setSun(
        sunWorld
          .copy(globe.sun.position)
          .transformDirection(globe.group.matrixWorld),
      );
      // The stars: celestial to ECEF by sidereal time, then turned by the
      // globe's placement in the world exactly as the sun's light is.
      sky.setCelestialRotation(
        globe.celestialToWorld(siderealAngleRad, celestial),
      );
      // Navy space, lighter towards the Earth (its centre through the frame).
      earthDirection.copy(earthCentreWorld()).sub(camera.position);
      const cameraDistance = earthDirection.length();
      sky.setSpace({
        strength: params.space,
        earthDirection,
        earthAngularRadiusRad: Math.asin(
          Math.min(1, radius / Math.max(cameraDistance, radius)),
        ),
      });
      sky.render(renderer, camera);
      // The ground sky over the space sky's pixels, before the Earth covers
      // the ground's (nothing above the edge).
      groundSky.render(camera);
    }
    renderer.render(scene, camera);
    // The cloud volume over the Earth, ending at the relief (C2).
    if (cloudVolume) cloudVolume.render(camera, terrain.tiles.group);
    // The air over the Earth and the sky, lit by the same sun (or, while
    // its cost is measured, as the measurement says).
    if (costMode === null ? params.atmo !== 0 : costMode === "on") {
      atmosphere.render(camera, {
        worldFromEcef: globe.tiles.group.matrixWorld,
        sunEcef: globe.surfaceUniforms.uSunEcef.value,
        sunIntensity: globe.sun.intensity,
        skyShare: 1 - skyHandOver.weight,
      });
    }
    hooks.frameEnd(performance.now());
  };
  // The Debug panel (round-6 plan 2026-10-04-1050 G6-0, DEC-G6-6): always
  // there; its live lines and Copy read this.
  const enu = {
    east: new THREE.Vector3(),
    north: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };
  const debugCamera = new THREE.Vector3();
  const debugTarget = new THREE.Vector3();
  const debugForward = new THREE.Vector3();
  const liveState = () => {
    const ellipsoid = globe.tiles.ellipsoid;
    globe.tiles.group.worldToLocal(debugCamera.copy(camera.position));
    const c = ellipsoid.getPositionToCartographic(debugCamera, {});
    ellipsoid.getEastNorthUpAxes(c.lat, c.lon, enu.east, enu.north, enu.up);
    // The view direction in the tiles' (ECEF) frame.
    camera.getWorldDirection(debugForward);
    debugForward.transformDirection(
      new THREE.Matrix4().copy(globe.tiles.group.matrixWorld).invert(),
    );
    const { phase, target } = flight.state();
    let distanceKm = null;
    if (target) {
      ellipsoid.getCartographicToPosition(
        target.lat * DEG,
        target.lng * DEG,
        0,
        debugTarget,
      );
      distanceKm = debugCamera.distanceTo(debugTarget) / 1000;
    }
    const gs = globe.state();
    const rs = terrain?.tiles.stats;
    return {
      altitudeKm: ellipsoid.getPositionElevation(debugCamera) / 1000,
      distanceKm,
      lat: c.lat / DEG,
      lng: c.lon / DEG,
      headingDeg:
        (Math.atan2(debugForward.dot(enu.east), debugForward.dot(enu.north)) /
          DEG +
          360) %
        360,
      pitchDeg:
        Math.asin(Math.max(-1, Math.min(1, debugForward.dot(enu.up)))) / DEG,
      fovDeg: camera.fov,
      nearKm: camera.near / 1000,
      farKm: camera.far / 1000,
      phase,
      e: terrain?.plugin.heightScale ?? null,
      bandShare: terrain ? bandShare : null,
      globeLoaded: gs.loadedTiles,
      globePending: gs.pendingTiles,
      globeMiB: globe.tiles.lruCache.cachedBytes / 2 ** 20,
      reliefVisible: terrain ? terrain.tiles.visibleTiles.size : null,
      reliefPending: rs ? rs.downloading + rs.parsing : null,
      reliefMiB: terrain ? terrain.tiles.lruCache.cachedBytes / 2 ** 20 : null,
      keptHeights: terrain ? terrain.heightKeeperStats() : null,
      programs: renderer.info.programs?.length ?? null,
      textures: renderer.info.memory.textures,
      hash: location.hash.slice(1, 400),
    };
  };
  debug = createGlobeDebug({
    log: debugLog,
    live: liveState,
    device: () => deviceBlock({ renderer, params, relief: Boolean(terrain) }),
  });
  renderer.setAnimationLoop(frame);

  /**
   * The atmosphere's cost on this device (review 2026-10-01, M2): on 10
   * animation frames each, alternating, three frames are drawn back to back
   * with the pass on or off and one pixel read so the GPU has finished;
   * the medians per frame go to the device line (`atmosphereCostText`).
   * The plate's button shows "Measuring..." meanwhile and is disabled.
   */
  const measureAtmosphereCost = async () => {
    const onMs = [];
    const offMs = [];
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const time = (mode) => {
      costMode = mode;
      frame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < 3; i++) frame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return (performance.now() - t0) / 3;
    };
    try {
      for (let k = 0; k < 20; k++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (k % 2 === 0) onMs.push(time("on"));
        else offMs.push(time("off"));
      }
    } finally {
      costMode = null;
    }
    return atmosphereCostText({
      supported: atmosphere.supported,
      onMs,
      offMs,
    });
  };
  let costText = null;
  costButton.addEventListener("click", async () => {
    const label = costButton.textContent;
    costButton.disabled = true;
    costButton.textContent = "Measuring...";
    try {
      costText = await measureAtmosphereCost();
    } catch {
      costText = atmosphereCostText({ supported: true, onMs: [], offMs: [] });
    } finally {
      costButton.disabled = false;
      costButton.textContent = label;
    }
    device.showCost(costText);
  });

  const raycaster = new THREE.Raycaster();
  /**
   * The centre ray, aimed 1e-5 of the half-frame off both axes (about 50 m
   * on the ground at the fitted distance). Observed 2026-09-26: a ray that
   * crosses a tile edge of constant latitude (the equator, and every
   * parallel a level splits on) exactly found no tile, or at a tile corner
   * the far side of the Earth; 0.01° away it hit. Whether the cause is the
   * tiles' shared vertices or three's triangle test is not established.
   * The offset stays inside the measured miss, so it only makes the check
   * stricter.
   */
  const centre = new THREE.Vector2(1e-5, 1e-5);
  /**
   * The latitude and longitude under the canvas centre, in degrees, found
   * through the library's own frame: a ray against the drawn tiles, the hit
   * converted by the tiles' ellipsoid. Null before any tile is hit.
   */
  const centreLatLon = () => {
    raycaster.setFromCamera(centre, camera);
    const hit = raycaster.intersectObject(surfaceTiles().group, true)[0];
    // A hit beyond the Earth's centre is on the far side: the ray slipped
    // past the near surface, so there is no answer, not a wrong one.
    if (!hit || hit.distance > camera.position.distanceTo(earthCentreWorld()))
      return null;
    const local = globe.tiles.group.worldToLocal(hit.point.clone());
    const c = globe.tiles.ellipsoid.getPositionToCartographic(local, {});
    return { lat: c.lat / DEG, lng: c.lon / DEG };
  };

  /**
   * Where a world DIRECTION shows on the canvas (normalised, 0,0 top-left),
   * as the sky pass draws it: the view's rotation only. Null behind the
   * camera.
   */
  const projectDirection = (direction) => {
    sky.syncCamera(camera);
    const view = direction
      .clone()
      .normalize()
      .transformDirection(sky.camera.matrixWorldInverse);
    if (view.z >= 0) return null;
    const p = direction.clone().normalize().project(sky.camera);
    return [(p.x + 1) / 2, (1 - p.y) / 2];
  };

  /**
   * One full read of the drawing buffer (after a render): inside and outside
   * a circle (normalised centre, radius in device pixels), the luminance sum
   * and the count of pixels brighter than `threshold`. For the stars'
   * smokes: how much is drawn over the Earth's disc, and in space.
   */
  const regionStats = ({ cx, cy, rPx }, threshold) => {
    frame();
    const gl = renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const out = {
      insideSum: 0,
      insideBright: 0,
      outsideSum: 0,
      outsideBright: 0,
    };
    for (let y = 0; y < h; y++) {
      const dy = h - 1 - y + 0.5 - cy * h;
      for (let x = 0; x < w; x++) {
        const i = 4 * (y * w + x);
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        const dx = x + 0.5 - cx * w;
        const inside = dx * dx + dy * dy <= rPx * rPx;
        if (inside) {
          out.insideSum += l;
          if (l > threshold) out.insideBright += 1;
        } else {
          out.outsideSum += l;
          if (l > threshold) out.outsideBright += 1;
        }
      }
    }
    return out;
  };

  window.__globeLab = {
    ready: true,
    error: null,
    state: () => ({
      ...globe.state(),
      ...flight.state(),
      appliedHash,
      centreLatLon: centreLatLon(),
      timeMs: sunNow(),
      clock: { ...params.clock, scale: clock.scale },
      hourLabel: document.querySelector('output[data-for="hour"]').textContent,
      cloudDrift: params.cloudDrift,
      // The sky hand-over (F2b): the ground sky's state, and the observer's
      // height over the ellipsoid's image it is fed from (km).
      groundSky: { ...groundSky.state(), observerAltitudeKm: observerKm },
      // The clip planes in effect and the drawn ground they were fitted to.
      // The haze (F2b) and the renderer's program count (a fog that came
      // and went at the edge would recompile every material).
      haze: haze.state(),
      cloudVolume: cloudVolume?.state() ?? null,
      programs: renderer.info.programs?.length ?? null,
      planes: {
        near: camera.near,
        far: camera.far,
        clearanceM: planeClearanceM,
        samples: planeSamples,
      },
      // What the shader reads: the clouds' drift east, radians.
      cloudLonOffsetRad: globe.surfaceUniforms.uCloudLonOffset.value,
      sunEcef: globe.surfaceUniforms.uSunEcef.value.toArray(),
      // The sky fill (DEC-GL5-11) as the shader reads it.
      skyFill: {
        floor: globe.surfaceUniforms.uSkyFloor.value,
        share: globe.surfaceUniforms.uSkyShare.value,
      },
      // What the shader reads, not what the hash says.
      look: {
        grade: globe.surfaceUniforms.uGrade.value,
        cloudRelief: globe.surfaceUniforms.uCloudRelief.value,
        twilight: globe.surfaceUniforms.uTwilight.value,
        space: sky.uniforms.uSpace.value,
        starGlow: sky.starUniforms.uStarGlow.value,
      },
      tuning: {
        nightGain: globe.surfaceUniforms.uNightGain.value,
        waterRoughness: globe.surfaceUniforms.uWaterRoughness.value,
        cloudOpacity: globe.surfaceUniforms.uCloudOpacity.value,
      },
      distance,
      pin: pin.state(),
      // Who moves the camera, and where it is (round-2 plan M3a, M3b).
      cameraOwner: flight.drives ? "intro" : "controls",
      cameraDistanceM: ecefCamera().position.length(),
      cameraDirection: asArray(ecefCamera().position.normalize()),
      // The world frame's target (F2a), null in ECEF.
      worldFrame: worldFrame.target,
      // The view's depression below the local horizontal (the oblique
      // flight's pitch, round-5 plan §3.5), degrees.
      cameraDepressionDeg:
        (Math.asin(
          Math.min(
            1,
            new THREE.Vector3(0, 0, -1)
              .applyQuaternion(ecefCamera().quaternion)
              .dot(ecefCamera().position.negate().normalize()),
          ),
        ) *
          180) /
        Math.PI,
      frameAt,
      // The readout's text as of the last frame, and what the line shows
      // (the line is throttled, so it may lag by up to 250 ms).
      readout: readoutText,
      readoutShown: readoutLine.textContent,
      altitudeM: globe.tiles.ellipsoid.getPositionElevation(
        globe.tiles.group.worldToLocal(camera.position.clone()),
      ),
      near: camera.near,
      far: camera.far,
      sunIntensity: globe.sun.intensity,
      sky: {
        on: params.sky !== 0,
        sunDiameterDeg: (sky.uniforms.uSunRadius.value * 2) / DEG,
        glow: sky.uniforms.uGlow.value,
        sunDirection: sky.uniforms.uSunDirection.value.toArray(),
        sunScreen: projectDirection(sky.uniforms.uSunDirection.value),
        stars: {
          on: sky.stars.visible,
          magLimit: sky.starUniforms.uMagLimit.value,
          count: sky.visibleStars(),
          // Celestial direction of the brightest star, as the GPU decodes it.
          brightest: sky.brightestStar(),
          procedural: true,
        },
        milkyWay: sky.uniforms.uMilkyWay.value,
        siderealAngleRad,
      },
      atmosphere: {
        on: params.atmo !== 0,
        supported: atmosphere.supported,
        ...atmosphere.look,
      },
      fovY: params.fovY,
      cameraFov: camera.fov,
      relief: terrain
        ? {
            heightScale: terrain.plugin.heightScale,
            litTiles: terrain.litTiles(),
            visibleTiles: terrain.tiles.visibleTiles.size,
            heights: startParams.reliefHeights,
            share: bandShare,
            groundUnderCameraM,
            clearanceLifts,
            // The relief's own loading, as the library counts it (its own
            // cache and queues, so `settled` is the relief's alone).
            stats: (({ queued, downloading, parsing, loaded, failed }) => ({
              queued,
              downloading,
              parsing,
              loaded,
              failed,
            }))(terrain.tiles.stats),
            cachedBytes: terrain.tiles.lruCache.cachedBytes,
            globeCachedBytes: globe.tiles.lruCache.cachedBytes,
            releasedBytes: { ...released },
            // The decoded heights kept past their tiles, and the height
            // tiles requested so far (synthetic heights only; DEC-N1).
            keptHeights: terrain.heightKeeperStats(),
            heightRequests: syntheticHeights?.requests.length ?? null,
            lastRelease: {
              globe: outOfBand.globe.last,
              relief: outOfBand.relief.last,
            },
            settled:
              terrain.tiles.loadProgress === 1 &&
              !terrain.tiles.downloadQueue.running &&
              !terrain.tiles.parseQueue?.running &&
              !terrain.tiles.processNodeQueue?.running,
            globeDrawn: globe.tiles.group.visible,
            reliefDrawn: terrain.tiles.group.visible,
            globeTiles: globe.tiles.visibleTiles.size,
            detail: detailRegion.state(),
          }
        : null,
      zoomOutLimitM: zoomOutM(),
      pixelRatio: renderer.getPixelRatio(),
      errorTarget: globe.tiles.errorTarget,
      bytesDownloaded: globeBytesDownloaded(),
      tileRequestsByLevel: tileRequestsByLevel(),
      rendererMemory: { ...renderer.info.memory },
      radiusM: radius,
      device: { floatLinear: device.floatLinear },
      deviceLine: deviceLine.textContent,
      atmosphereCost: costText,
      costMeasuring: costButton.disabled,
      activeSources: globe.activeSources(),
      loadingShown: status.loadingShown,
      loadingVisible: !loadingLabel.hidden,
      cacheBudgetBytes: globe.tiles.lruCache.maxBytesSize,
      cacheFloorBytes: globe.tiles.lruCache.minBytesSize,
      creditShorts: credits.map((c) => c.short),
    }),
    /**
     * Where a latitude and longitude (degrees, on the ellipsoid) is on the
     * canvas, normalised (0,0 = top-left), for probes at known places.
     */
    project(lat, lng) {
      // The ground point in ECEF, then through the frame into the world
      // (F2a: the world is the target's local frame once it has one).
      const p = globe.tiles.ellipsoid
        .getCartographicToPosition(lat * DEG, lng * DEG, 0, new THREE.Vector3())
        .applyMatrix4(globe.tiles.group.matrixWorld)
        .project(camera);
      return [(p.x + 1) / 2, (1 - p.y) / 2];
    },
    regionStats,
    /**
     * A test hook (review 2026-10-01, M1): takes the camera from the flight
     * and the controls, as a press would, and pitches it up by `deg` about
     * its own right axis, so a view from inside the air shows the sky above
     * the horizon (the dive itself always looks straight down). The view is
     * then held, without the controls, until the page reloads.
     */
    pitchView(deg) {
      if (!Number.isFinite(deg))
        throw new RangeError(`pitch must be finite, got ${deg}`);
      flight.yieldToUser(performance.now());
      pin?.cameraTaken();
      heldView = true;
      camera.rotateX(deg * DEG);
      camera.updateMatrixWorld();
      frame();
    },
    /**
     * A test hook (round-5 M1): the last ease of the field of view back to
     * fovY, read by TIME rather than by the frames that happened to land:
     * `{ from, to, ms, at, lastFrameAt, fov }`, `fov` being what the frame
     * loop sets `fraction` x `ms` after the ease began (at `at`,
     * performance.now()); `lastFrameAt` is when a frame last applied it, so
     * a test can check the camera holds exactly that frame's value (review
     * 2026-10-01-2124 Minor 5). Null before any ease.
     */
    fovReturnAt(fraction) {
      if (!Number.isFinite(fraction))
        throw new RangeError(`fraction must be finite, got ${fraction}`);
      if (!lastFovReturn) return null;
      const { from, to, ms, at, lastFrameAt } = lastFovReturn;
      return {
        from,
        to,
        ms,
        at,
        lastFrameAt,
        fov: fovAt(lastFovReturn, fraction * ms),
      };
    },
    /**
     * The cost probe (round-4 plan DEC-GL4-2/4): `n` frames drawn back to
     * back, then one pixel read so the GPU has finished them; the wall
     * time in ms. Under SwiftShader it is relative only: compare two
     * settings within one page load, never across machines.
     */
    /**
     * For the smokes: plants a detail grid over the target (128 km either
     * side) whose factor is `eastFactor` east of the target and 1 west of
     * it, in place of the region's; null without a relief or a target.
     */
    plantDetail(eastFactor) {
      const target = flight.state().target;
      if (!terrain || !target) return null;
      const side = 65;
      const extentM = 128_000;
      const ratio = new Float32Array(side * side);
      for (let r = 0; r < side; r++) {
        for (let c = 0; c < side; c++) {
          const x = -extentM + (c * 2 * extentM) / (side - 1);
          ratio[r * side + c] = x > 0 ? eastFactor : 1;
        }
      }
      terrain.setDetail({ ratio, side, extentM, halfM: extentM }, target);
      return target;
    },
    /** The dive's altitude at a dive time (m), the camera unmoved. */
    diveAltitudeAt: (ms) => flight.diveAltitudeAt(ms),
    /** Holds the camera at a dive time (ms; null runs on); its altitude. */
    holdDiveAt: (ms) => flight.holdDiveAt(ms),
    timeFrames(n) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      frame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) frame();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return performance.now() - t0;
    },
    /**
     * A celestial direction [x, y, z] (x to RA 0h, z to the pole) in the
     * world frame, turned by the rotation the sky pass renders the stars
     * with (after a frame, so it is the current one).
     */
    celestialToWorld(v) {
      frame();
      return new THREE.Vector3(...v)
        .applyQuaternion(sky.stars.quaternion)
        .toArray();
    },
    /**
     * The same direction in ECEF (F2a): the world direction taken back
     * through the frame, for a smoke that turns it into a latitude and a
     * longitude (the world is the target's local frame once it has one).
     */
    celestialToEcef(v) {
      frame();
      return new THREE.Vector3(...v)
        .applyQuaternion(sky.stars.quaternion)
        .transformDirection(
          new THREE.Matrix4().copy(globe.tiles.group.matrixWorld).invert(),
        )
        .toArray();
    },
    /** Where a celestial direction shows on the canvas, or null. */
    projectCelestial(v) {
      frame();
      return projectDirection(
        new THREE.Vector3(...v).applyQuaternion(sky.stars.quaternion),
      );
    },
    /** Where a world direction [x, y, z] shows on the canvas, or null. */
    projectDirection: ([x, y, z]) =>
      projectDirection(new THREE.Vector3(x, y, z)),
    /**
     * Render one frame and read RGBA bytes at normalised canvas points
     * (0,0 = top-left), in the same task as the render.
     */
    readPixels(points) {
      frame();
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
    /**
     * Hides the relief's tiles (true) or shows them again, to check that
     * the globe fills every pixel the relief leaves (round-6 plan G6-1).
     */
    /**
     * A test hook (F2a, M4): the clip planes at the held view. Renders the
     * frame, moves the camera `jitterM` along its right axis, renders it
     * again, and moves it back, with the camera held (not the controls').
     * Returns the share of pixels whose channels moved by more than
     * `levels` between the two (z-fighting flips them at any movement),
     * the share of the first frame's lower two thirds showing the clear
     * colour (magenta with `holeColor=1`: a clipped ground), the planes,
     * and the pixel count.
     */
    planeProbe({ jitterM, levels }) {
      if (!(Number.isFinite(jitterM) && Number.isFinite(levels))) {
        throw new RangeError("jitterM and levels must be finite");
      }
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const held = heldView;
      heldView = true;
      const read = () => {
        frame();
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      const a = read();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
        camera.quaternion,
      );
      camera.position.addScaledVector(right, jitterM);
      camera.updateMatrixWorld();
      const b = read();
      camera.position.addScaledVector(right, -jitterM);
      camera.updateMatrixWorld();
      heldView = held;
      let changed = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (
          Math.abs(a[i] - b[i]) > levels ||
          Math.abs(a[i + 1] - b[i + 1]) > levels ||
          Math.abs(a[i + 2] - b[i + 2]) > levels
        ) {
          changed += 1;
        }
      }
      // The lower two thirds: rows 0 to 2h/3 (readPixels starts at the
      // bottom).
      let background = 0;
      const rows = Math.floor((2 * h) / 3);
      for (let i = 0; i < rows * w * 4; i += 4) {
        if (a[i] >= 240 && a[i + 2] >= 240 && a[i + 1] <= 15) background += 1;
      }
      return {
        changedShare: changed / (w * h),
        backgroundShare: background / (rows * w),
        near: camera.near,
        far: camera.far,
        pixels: w * h,
      };
    },
    hideRelief(on) {
      reliefHidden = Boolean(on);
    },
    /**
     * Hides the cloud shell (true) or shows it as the hash says, so a
     * smoke reads the ground under it alone (round-6 plan G6-2).
     */
    /**
     * Moves the world frame to a target (null: ECEF), the view unchanged,
     * so a smoke compares the frame before and after the switch (F2a).
     */
    reframe(target) {
      setFrameTarget(target);
    },
    /**
     * A test hook (volume-cloud plan §14): places the held camera at a
     * Debug export's pose, `{ lat, lng, altitudeKm, headingDeg, pitchDeg }`
     * (degrees, the heading from north toward east, the pitch above the
     * local horizontal), so a smoke can stand where the owner stood.
     */
    placeView({ lat, lng, altitudeKm, headingDeg, pitchDeg }) {
      const values = [lat, lng, altitudeKm, headingDeg, pitchDeg];
      if (!values.every(Number.isFinite)) {
        throw new RangeError(`a view needs finite values, got ${values}`);
      }
      flight.yieldToUser(performance.now());
      pin?.cameraTaken();
      heldView = true;
      const ellipsoid = globe.tiles.ellipsoid;
      const position = ellipsoid.getCartographicToPosition(
        lat * DEG,
        lng * DEG,
        altitudeKm * 1000,
        new THREE.Vector3(),
      );
      const east = new THREE.Vector3();
      const north = new THREE.Vector3();
      const up = new THREE.Vector3();
      ellipsoid.getEastNorthUpAxes(lat * DEG, lng * DEG, east, north, up);
      const h = headingDeg * DEG;
      const p = pitchDeg * DEG;
      const forward = east
        .clone()
        .multiplyScalar(Math.sin(h) * Math.cos(p))
        .addScaledVector(north, Math.cos(h) * Math.cos(p))
        .addScaledVector(up, Math.sin(p));
      // A camera looks down its -z: lookAt(eye, target) points -z at target.
      const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), forward, up);
      placeCameraEcef(
        position,
        new THREE.Quaternion().setFromRotationMatrix(look),
      );
      camera.updateMatrixWorld();
      frame();
    },
    hideCloudShell(on) {
      cloudShellHidden = Boolean(on);
    },
    /**
     * The cloud volume's last frame read back (`globe-cloud-volume.js`
     * `coverage()`): the share of pixels its clouds cover, overall and in
     * the lower half. Null without a volume or before its first frame.
     */
    cloudVolumeCoverage: () => cloudVolume?.coverage() ?? null,
    /** The frame-hitch recorder's smoke API once it is loaded, else null. */
    perf: null,
    /** The Debug panel's smoke API (`globe-debug.js`). */
    debug: debug.api,
  };

  // The frame-hitch recorder (frame-hitch plan 2026-10-03-2017 §4), loaded
  // only with #perf=1: its handle on the page is what it reads (cheap
  // counts, no raycasts, so it never adds to what it counts) and the few
  // things it sets.
  if (params.perf === 1) {
    const { createGlobePerf } = await import("./globe-perf.js");
    let tookCamera = false;
    const altitudeNow = () =>
      globe.tiles.ellipsoid.getPositionElevation(
        globe.tiles.group.worldToLocal(camera.position.clone()),
      );
    perf = createGlobePerf({
      renderer,
      canvas,
      globe,
      terrain,
      params: () => params,
      counts: () => ({
        ...globe.state(),
        altitudeM: altitudeNow(),
        relief: terrain
          ? {
              share: bandShare,
              heightScale: terrain.plugin.heightScale,
              visibleTiles: terrain.tiles.visibleTiles.size,
              stats: terrain.tiles.stats,
              cachedBytes: terrain.tiles.lruCache.cachedBytes,
              globeCachedBytes: globe.tiles.lruCache.cachedBytes,
            }
          : null,
      }),
      /**
       * The camera over `place` at `altitudeM`, pitched by the flight's
       * law (`pitchAtDeg`), as the dive places it. The first call takes
       * the camera from the fly-in and the pin, as a press would.
       */
      placeCamera(place, altitudeM) {
        const now = performance.now();
        if (!tookCamera) {
          tookCamera = true;
          flight.yieldToUser(now);
          pin?.cameraTaken();
          controls.release();
        }
        const ellipsoid = globe.tiles.ellipsoid;
        const view = obliqueCamera(
          ellipsoid,
          orbitPose(ellipsoid, place),
          altitudeM,
          pitchAtDeg(altitudeM, { pitchLowDeg: params.pitchLow }),
        );
        placeCameraEcef(view.position, view.quaternion);
        returnFov(now);
        controls.followIntro();
      },
      updateControls: () => controls.update(),
      altitudeM: altitudeNow,
      /**
       * One frame of a zoom driven through the controls (§4.2, H5): a
       * wheel event of `deltaY` at the canvas centre, then their update,
       * as a wheel or a pinch runs them.
       */
      wheelZoom(deltaY) {
        if (deltaY !== 0) {
          const rect = canvas.getBoundingClientRect();
          canvas.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY,
              deltaMode: 0,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        controls.update();
      },
      /** The drawn carriers' queues are empty. */
      settled() {
        const globeIdle = bandShare >= 1 || globe.state().pendingTiles === 0;
        const reliefIdle =
          !terrain ||
          bandShare <= 0 ||
          (terrain.tiles.loadProgress === 1 &&
            !terrain.tiles.downloadQueue.running &&
            !terrain.tiles.parseQueue.running &&
            !terrain.tiles.processNodeQueue.running);
        return globeIdle && reliefIdle;
      },
      /** A cell's factors, or the hash's again (null). */
      setFactors(cell) {
        const f = cell ?? params;
        applyFactors(f);
        const ratio = Math.min(window.devicePixelRatio, f.pixelRatio);
        if (renderer.getPixelRatio() !== ratio) {
          renderer.setPixelRatio(ratio);
          fittedSize = "";
        }
      },
      setEOverride(e) {
        eOverride = e;
      },
      currentE: () => terrain?.plugin.heightScale ?? null,
    });
    window.__globeLab.perf = perf.api;
  }
}

start().catch((e) => {
  window.__globeLab = { ready: false, error: String(e?.stack ?? e) };
  errorBox.textContent = String(e);
  throw e;
});
