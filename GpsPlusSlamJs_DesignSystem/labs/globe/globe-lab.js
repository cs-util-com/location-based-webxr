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

import { GLOBE_SURFACE, createGlobeSurface } from "/globe/globe-surface.js";
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
  orbitDistanceToFit,
  orbitPose,
  smoothstep,
  turnPose,
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
import { GLOBE_DIVE, diveStep, planDive } from "/globe/globe-dive.js";
import { globePinView, nextPinPhase } from "/globe/globe-pin.js";
import { globeReadoutText, readoutThrottle } from "/globe/globe-readout.js";
import { handOverUrl } from "/globe/globe-handover.js";
import {
  apparentSolarTimeHours,
  solarDateAt,
  solarPosition,
} from "/fw/geo/solar-position.js";
import { labelFor, locateAdvice, locateOnce } from "/fw/utils/locate-state.js";

const canvas = document.getElementById("globe-canvas");
const errorBox = document.getElementById("globe-error");
const creditsBox = document.getElementById("globe-credits");
const loadingLabel = document.getElementById("globe-loading");
const replayButton = document.getElementById("globe-replay");
const pinButton = document.getElementById("globe-pin");
const pinStatus = document.getElementById("globe-pin-status");
const deviceLine = document.getElementById("globe-device");
const readoutLine = document.getElementById("globe-readout");

/**
 * The device line (round-3 plan 2026-09-27-0532 §4 F; terrain plan
 * 2026-09-27-0605 §7): whether this device can filter float textures
 * linearly (`OES_texture_float_linear`), which the terrain dive needs, so
 * the owner can read it on his phone before that work starts. Asked once,
 * of the renderer's own context.
 */
function reportDevice(renderer) {
  const floatLinear = renderer.extensions.has("OES_texture_float_linear");
  deviceLine.textContent = floatLinear
    ? "This device filters float textures (OES_texture_float_linear): yes"
    : "This device filters float textures (OES_texture_float_linear): NO";
  return { floatLinear };
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
      // The tiles and the three global maps (the clouds are the largest
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
          ? `${mapErrors} of the night-light, water and cloud maps could not load.`
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
function renderCredits(credits) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = `Imagery: ${credits.map((c) => c.short).join(" · ")}. ${PROCEDURAL_STARS}`;
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
/** Where the spin starts: North Africa and Europe. */
const SPIN_START = { lat: 30, lng: 15 };
/**
 * The spin while the page waits for a target, in degrees per second. The
 * view's longitude falls, so the surface moves west to east across the
 * screen, the way the Earth turns.
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
  // The pin's dive (round-2 plan 2026-09-26-2055 M3g): its length, the
  // altitude it hands over at (km; the {20, 50, 150} sweep for the look),
  // and whether it then opens the city (0 holds at the hand-over altitude,
  // to look at it).
  diveMs: { fallback: GLOBE_DIVE.durationMs, min: 1000, max: 60_000 },
  handOverKm: {
    fallback: GLOBE_DIVE.handOverAltitudeM / 1000,
    min: 1,
    max: 1000,
  },
  handOver: { fallback: 1, min: 0, max: 1 },
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
  starGain: { fallback: GLOBE_SKY.starGain, min: 0, max: 4 },
  milkyWay: { fallback: GLOBE_SKY.milkyWay, min: 0, max: 0.1 },
  fovY: { fallback: 50, min: 20, max: 80 },
  pixelRatio: { fallback: 2, min: 0.5, max: 4 },
  errorTarget: { fallback: null, min: 0.25, max: 256 },
  cacheMiB: { fallback: null, min: 8, max: 4096 },
};

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
    url: parseLatLngText(params.get("at")),
    clock,
    timeScale: clock.scale ?? (clock.startMs === null ? 1 : 0),
  };
}

/** What restarts the intro when it changes; everything else applies live. */
const flightKey = (p) =>
  JSON.stringify([p.url?.lat, p.url?.lng, p.spinMs, p.turnMs]);

/** A longitude wrapped into [-180, 180). */
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

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
 */
function introFlight(ellipsoid) {
  let params;
  let startedAt;
  let phase;
  let choice;
  let from;
  let to;
  let turnStartedAt;
  let history;
  let runs = 0;
  /** The dive in progress (`planDive`) and when it began. */
  let dive = null;
  let diveStartedAt = 0;
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
    note(now);
  };
  const spinPose = (now) =>
    orbitPose(ellipsoid, {
      lat: SPIN_START.lat,
      lng: wrapLng(
        SPIN_START.lng + (SPIN_DEG_PER_S * (now - startedAt)) / 1000,
      ),
    });
  /** The spin, the turn and the hold. */
  const introPose = (now) => {
    if (phase === "spin") {
      const next = chooseGlobeTarget({
        url: params.url,
        fix: null,
        fallback: GLOBE_FALLBACK_TARGET,
        fixWaitExpired: now - startedAt >= params.spinMs,
      });
      if (next.source !== choice.source) {
        choice = next;
        if (next.target) {
          from = spinPose(now);
          to = orbitPose(ellipsoid, next.target);
          turnStartedAt = now;
          phase = "turning";
        }
        note(now);
      }
      if (phase === "spin") return spinPose(now);
    }
    if (phase === "turning") {
      const t = params.turnMs > 0 ? (now - turnStartedAt) / params.turnMs : 1;
      if (t < 1) return turnPose(from, to, smoothstep(t));
      phase = "arrived";
      note(now);
    }
    return to;
  };
  return {
    restart,
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
    dive(now, target, start, { durationMs, toAltitudeM }) {
      dive = planDive(ellipsoid, start, orbitPose(ellipsoid, target), {
        durationMs,
        toAltitudeM,
      });
      diveStartedAt = now;
      choice = { target, source: "pin" };
      phase = "diving";
      note(now);
    },
    /** The pose for this frame, advancing the states. */
    pose(now) {
      if (phase === "diving" || phase === "landed") {
        const step = diveStep(dive, now - diveStartedAt);
        if (step.done && phase === "diving") {
          phase = "landed";
          note(now);
        }
        return step;
      }
      return { pose: introPose(now) };
    },
    state: () => ({
      phase,
      target: choice.target,
      source: choice.source,
      history: history.slice(),
      runs,
      spinMs: params.spinMs,
      turnMs: params.turnMs,
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
function cameraControls(scene, camera, globe, onTake) {
  const controls = new GlobeControls(scene, camera, canvas);
  controls.setEllipsoid(globe.tiles.ellipsoid, globe.tiles.group);
  controls.enableDamping = true;
  controls.addEventListener("start", onTake);
  const local = new THREE.Vector3();
  return {
    followIntro() {
      local.copy(camera.position);
      globe.tiles.group.worldToLocal(local);
      const { near, far } = clipPlanes(globe.tiles.ellipsoid, local);
      if (camera.near !== near || camera.far !== far) {
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
      controls.getCameraUpDirection(controls.up);
    },
    update() {
      controls.update();
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
 * straight along it, the view's forward direction, then north). The lab's
 * tile group sits at the world's origin unturned, so world = ECEF here.
 */
function currentPose(camera) {
  const direction = camera.position.clone().normalize();
  for (const axis of [
    new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
    new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion),
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
 */
function bindPin({ flight, controls, camera, getParams, sceneMs, navigate }) {
  let phase = "idle";
  let message = "";
  let lastUrl = null;
  let located = null;
  /** The last failure (denied, timeout, unavailable), until the next press. */
  let failure = null;
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
    // The intro takes the camera: no drag or momentum left to resume.
    controls.release();
    flight.dive(
      performance.now(),
      located,
      {
        pose: currentPose(camera),
        distanceM: camera.position.length(),
        quaternion: camera.quaternion.clone(),
      },
      { durationMs: params.diveMs, toAltitudeM: params.handOverKm * 1000 },
    );
    go("located");
  });
  render();
  return {
    /** The controls took the camera, or the intro restarted. */
    cameraTaken() {
      if (phase === "flying") go("touch");
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
    /** Per frame: a landed dive hands over (or holds). */
    frame() {
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
      navigate(lastUrl);
    },
    state: () => ({
      phase,
      label: globePinView(phase).label,
      status: pinStatus.textContent,
      located,
      handOverUrl: lastUrl,
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
 * texel of level 3 spans more than the error target.
 */
function tileRequestsByLevel() {
  const levels = [0, 0, 0, 0, 0];
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

function start() {
  // The default log keeps 250 entries: fewer than the committed pyramid
  // (682 tiles with level 4).
  performance.setResourceTimingBufferSize(4000);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Phase 1's exposure (§7.3): Neutral tone mapping (the look-dev
  // default), no ambient light, a black sky; the sun at the surface's own
  // intensity (5 since round 4, DEC-GL4-1; π in phase 1).
  renderer.toneMapping = THREE.NeutralToneMapping;
  // The frame clears once, then draws the sky pass, then the Earth over it.
  renderer.autoClear = false;
  const sky = createGlobeSky();
  const sunWorld = new THREE.Vector3();
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
  const globe = createGlobeSurface();
  useSurfaceDefaults(globe);
  scene.add(globe.group);
  const credits = creditsFor(globe.activeSources());
  renderCredits(credits);
  const status = statusView();
  const flight = introFlight(globe.tiles.ellipsoid);
  // Set once the pin exists (below); a touch before that has no flight.
  let pin = null;
  const controls = cameraControls(scene, camera, globe, () => {
    flight.yieldToUser(performance.now());
    pin?.cameraTaken();
  });
  /** The replay button or a new target or timing: the intro again. */
  const giveBackToIntro = () => {
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
    sky.setStarLook({
      magLimit: params.starMag,
      gain: params.starGain,
      milkyWay: params.milkyWay,
      pixelRatio: renderer.getPixelRatio(),
      visible: params.stars !== 0,
    });
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
  flight.restart(performance.now(), params);
  applyLive();
  syncPanel();
  window.addEventListener("hashchange", onHash);
  replayButton.addEventListener("click", giveBackToIntro);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pin?.hidden();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) pin?.returned();
  });
  pin = bindPin({
    flight,
    controls,
    camera,
    getParams: () => params,
    sceneMs,
    navigate: (url) => location.assign(url),
  });

  const frame = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Both sides: a phone's URL bar changes only the height.
    if (`${w}x${h}` !== fittedSize) {
      fittedSize = `${w}x${h}`;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      distance = orbitDistanceToFit({
        fovYRad: camera.fov * DEG,
        aspect: camera.aspect,
        margin: FIT_MARGIN,
        radius,
      });
    }
    sunNow();
    if (flight.drives) {
      const step = flight.pose(performance.now());
      if (step.pose) {
        applyOrbitPose(camera, step.pose, distance);
      } else {
        camera.position.copy(step.position);
        camera.quaternion.copy(step.quaternion);
      }
      camera.updateMatrixWorld();
      controls.followIntro();
    } else {
      controls.update();
    }
    pin.frame();
    globe.update(camera, renderer);
    status.update(globe.state());
    readoutText = readoutNow();
    readout.offer(readoutText, performance.now());
    // A running clock moves the hour: its label follows, once a second.
    const mono = performance.now();
    if (clock.scale !== 0 && mono - clockShownAt >= 1000) {
      clockShownAt = mono;
      panel.showClock();
    }
    // The sky pass first, from the direction the Earth is lit from (the
    // light's position in the surface's group, turned into the world), with
    // no depth, so the Earth drawn next covers it.
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
      sky.render(renderer, camera);
    }
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

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
    const hit = raycaster.intersectObject(globe.tiles.group, true)[0];
    // A hit beyond the Earth's centre is on the far side: the ray slipped
    // past the near surface, so there is no answer, not a wrong one.
    if (!hit || hit.distance > camera.position.length()) return null;
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
    spinStart: SPIN_START,
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
      // What the shader reads: the clouds' drift east, radians.
      cloudLonOffsetRad: globe.surfaceUniforms.uCloudLonOffset.value,
      sunEcef: globe.surfaceUniforms.uSunEcef.value.toArray(),
      // What the shader reads, not what the hash says.
      tuning: {
        nightGain: globe.surfaceUniforms.uNightGain.value,
        waterRoughness: globe.surfaceUniforms.uWaterRoughness.value,
        cloudOpacity: globe.surfaceUniforms.uCloudOpacity.value,
      },
      distance,
      pin: pin.state(),
      // Who moves the camera, and where it is (round-2 plan M3a, M3b).
      cameraOwner: flight.drives ? "intro" : "controls",
      cameraDistanceM: camera.position.length(),
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
          procedural: true,
        },
        milkyWay: sky.uniforms.uMilkyWay.value,
        siderealAngleRad,
      },
      fovY: camera.fov,
      pixelRatio: renderer.getPixelRatio(),
      errorTarget: globe.tiles.errorTarget,
      bytesDownloaded: globeBytesDownloaded(),
      tileRequestsByLevel: tileRequestsByLevel(),
      rendererMemory: { ...renderer.info.memory },
      radiusM: radius,
      device,
      deviceLine: deviceLine.textContent,
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
      const p = globe.tiles.ellipsoid
        .getCartographicToPosition(lat * DEG, lng * DEG, 0, new THREE.Vector3())
        .project(camera);
      return [(p.x + 1) / 2, (1 - p.y) / 2];
    },
    regionStats,
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
  };
}

try {
  start();
} catch (e) {
  window.__globeLab = { ready: false, error: String(e?.stack ?? e) };
  errorBox.textContent = String(e);
  throw e;
}
