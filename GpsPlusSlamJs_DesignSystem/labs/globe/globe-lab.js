/**
 * The globe lab (globe plan 2026-09-26-0539 §7, M0-M3): the globe package's
 * surface, served no-build through the design system's routes, textured and
 * credited (M1). It spins while it waits for a target, turns to it and
 * holds it at the centre, north up (M2). It is lit by the real sun of now or
 * of `#time=`, with night lights, a water glint and clouds (M3).
 *
 * @see globe-lab.js.md
 */
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { createGlobeSurface } from "/globe/globe-surface.js";
import { creditsFor } from "/globe/globe-credits.js";
import { GIBS_ACKNOWLEDGEMENT } from "/globe/globe-sources.js";
import {
  GLOBE_FALLBACK_TARGET,
  chooseGlobeTarget,
  parseLatLngText,
} from "/globe/globe-target.js";
import {
  applyOrbitPose,
  orbitDistanceToFit,
  orbitPose,
  smoothstep,
  turnPose,
} from "/globe/globe-camera.js";
import { sunDirectionEcef } from "/globe/globe-sun.js";
import { GLOBE_SURFACE_TUNING } from "/globe/globe-surface-material.js";
import { solarPosition } from "/fw/geo/solar-position.js";

const canvas = document.getElementById("globe-canvas");
const errorBox = document.getElementById("globe-error");
const creditsBox = document.getElementById("globe-credits");
const loadingLabel = document.getElementById("globe-loading");
const replayButton = document.getElementById("globe-replay");

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
  summary.textContent = `Imagery: ${credits.map((c) => c.short).join(" · ")}`;
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
 * The camera (globe plan §7.6, §7.9): fovY 50° with the disc filling 90 % of
 * the narrower side, the setting the z0-z3 imagery pyramid was sized for.
 */
const FOV_Y_DEG = 50;
const FIT_MARGIN = 0.1;
/** Where the spin starts: North Africa and Europe, on the lab sun's day side. */
const SPIN_START = { lat: 30, lng: 15 };
/**
 * The spin while the page waits for a target, in degrees per second. The
 * view's longitude falls, so the surface moves west to east across the
 * screen, the way the Earth turns.
 */
const SPIN_DEG_PER_S = -3;
/**
 * How long to wait for a fix before the fallback, and how long the turn
 * takes (lab parameters `#spinMs=` and `#turnMs=`, globe plan §7.5-§7.6).
 */
const DEFAULT_SPIN_MS = 3000;
const DEFAULT_TURN_MS = 5000;
const DEG = Math.PI / 180;

/** A non-negative duration from the hash, or the default. */
function readMs(params, name, fallback) {
  if (!params.has(name)) return fallback;
  const ms = Number(params.get(name));
  return params.get(name).trim() !== "" && Number.isFinite(ms) && ms >= 0
    ? ms
    : fallback;
}

/** A number from the hash within [min, max], or the default. */
function readNumber(params, name, fallback, min, max) {
  const text = params.get(name);
  const value = Number(text);
  return text !== null && text.trim() !== "" && value >= min && value <= max
    ? value
    : fallback;
}

/** An instant from the hash (`#time=<ISO>`), or null for "now". */
function readTime(params) {
  const ms = Date.parse(params.get("time") ?? "");
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The lab's parameters from the hash: `#at=<lat>,<lng>&spinMs=&turnMs=`,
 * `time=<ISO>`, and the surface's tuning `nightGain=`, `waterRoughness=`,
 * `cloudOpacity=` (M4 puts them on a panel).
 */
function readHashParams() {
  const params = new URLSearchParams(location.hash.slice(1));
  return {
    url: parseLatLngText(params.get("at")),
    spinMs: readMs(params, "spinMs", DEFAULT_SPIN_MS),
    turnMs: readMs(params, "turnMs", DEFAULT_TURN_MS),
    timeMs: readTime(params),
    tuning: {
      nightGain: readNumber(
        params,
        "nightGain",
        GLOBE_SURFACE_TUNING.nightGain,
        0,
        100,
      ),
      waterRoughness: readNumber(
        params,
        "waterRoughness",
        GLOBE_SURFACE_TUNING.waterRoughness,
        0,
        1,
      ),
      cloudOpacity: readNumber(
        params,
        "cloudOpacity",
        GLOBE_SURFACE_TUNING.cloudOpacity,
        0,
        1,
      ),
    },
  };
}

/** A longitude wrapped into [-180, 180). */
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/**
 * The intro's states (globe plan §7.6): `spin` until a target is chosen,
 * `turning` towards it, then `arrived`, holding it. `history` records each
 * phase and source change with its time since the start, and `runs`
 * counts the starts (the replay button, a hash change), so a test reads
 * the sequence instead of racing it.
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
  const note = (now) => {
    history.push({
      phase,
      source: choice.source,
      atMs: Math.round(now - startedAt),
    });
  };
  const restart = (now) => {
    params = readHashParams();
    startedAt = now;
    phase = "spin";
    choice = { target: null, source: "waiting" };
    history = [];
    runs += 1;
    note(now);
  };
  const spinPose = (now) =>
    orbitPose(ellipsoid, {
      lat: SPIN_START.lat,
      lng: wrapLng(
        SPIN_START.lng + (SPIN_DEG_PER_S * (now - startedAt)) / 1000,
      ),
    });
  return {
    restart,
    /** The pose for this frame, advancing the states. */
    pose(now) {
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
    },
    params: () => params,
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

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Phase 1's exposure (§7.3): the sun at intensity π, Neutral tone mapping
  // (the look-dev default), no ambient light, a black sky.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const radius = WGS84_ELLIPSOID.radius.x;
  const camera = new THREE.PerspectiveCamera(
    FOV_Y_DEG,
    1,
    radius * 0.01,
    radius * 20,
  );
  let distance = radius * 3;
  const globe = createGlobeSurface();
  scene.add(globe.group);
  const credits = creditsFor(globe.activeSources());
  renderCredits(credits);
  const status = statusView();
  const flight = introFlight(globe.tiles.ellipsoid);
  /** The hash's tuning onto the shared uniforms. */
  const applyTuning = () => {
    const { tuning } = flight.params();
    const u = globe.surfaceUniforms;
    u.uNightGain.value = tuning.nightGain;
    u.uWaterRoughness.value = tuning.waterRoughness;
    u.uCloudOpacity.value = tuning.cloudOpacity;
  };
  /** The sun of `#time=`, or of now (it moves 0.25° a minute). */
  const sunNow = () => {
    const ms = flight.params().timeMs ?? Date.now();
    globe.setSun(
      sunDirectionEcef(globe.tiles.ellipsoid, solarPosition(ms, 0, 0)),
    );
    return ms;
  };
  flight.restart(performance.now());
  applyTuning();
  window.addEventListener("hashchange", () => {
    flight.restart(performance.now());
    applyTuning();
  });
  replayButton.addEventListener("click", () =>
    flight.restart(performance.now()),
  );

  let fittedSize = "";
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
        fovYRad: FOV_Y_DEG * DEG,
        aspect: camera.aspect,
        margin: FIT_MARGIN,
        radius,
      });
    }
    sunNow();
    applyOrbitPose(camera, flight.pose(performance.now()), distance);
    camera.updateMatrixWorld();
    globe.update(camera, renderer);
    status.update(globe.state());
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

  window.__globeLab = {
    ready: true,
    spinStart: SPIN_START,
    error: null,
    state: () => ({
      ...globe.state(),
      ...flight.state(),
      centreLatLon: centreLatLon(),
      timeMs: sunNow(),
      sunEcef: globe.surfaceUniforms.uSunEcef.value.toArray(),
      tuning: flight.params().tuning,
      radiusM: radius,
      activeSources: globe.activeSources(),
      loadingShown: status.loadingShown,
      loadingVisible: !loadingLabel.hidden,
      cacheBudgetBytes: globe.tiles.lruCache.maxBytesSize,
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
