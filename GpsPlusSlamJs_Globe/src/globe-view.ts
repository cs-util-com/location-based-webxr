/**
 * The globe's view core: the renderer, the scene, the camera, the surface,
 * the sky pass (the sun's disc, the stars, navy space), the clock that
 * drives the sun and the clouds' drift, the world frame every camera pose
 * goes through, the buffer's fit, and the frame in its order, with seams
 * for what a page draws or drives around it (the camera's driver, the
 * page's layers, its air, its dust, its volumes). Moved out of the globe
 * lab as a pure refactor (the full-globe editor plan 2026-10-27-1850): the
 * lab is a page over it, and draws exactly what it drew before.
 */

import * as THREE from "three";
import { WGS84_ELLIPSOID, type Ellipsoid } from "3d-tiles-renderer";

import { orbitDistanceToFit } from "./globe-camera.js";
import {
  advanceCloudLonOffsetRad,
  cloudDriftDegPerS,
} from "./globe-cloud-drift.js";
import {
  startGlobeClock,
  type GlobeClock,
  type GlobeClockSetting,
} from "./globe-clock.js";
import {
  applyEcefPose,
  ecefPoseOf,
  frameRecentreTarget,
  worldFromEcefAt,
  type EcefPose,
} from "./globe-frame.js";
import type { GlobeSurfaceLoader } from "./globe-map-loader.js";
import { createGlobeSky, type GlobeSky } from "./globe-sky.js";
import { greenwichSiderealAngleRad } from "./globe-stars.js";
import { sunDirectionEcef } from "./globe-sun.js";
import { cloudLonOffsetRad } from "./globe-surface-material.js";
import { createGlobeSurface, type GlobeSurface } from "./globe-surface.js";

const DEG = Math.PI / 180;

/** The fit's margin around the globe (a tenth of its radius). */
const FIT_MARGIN = 0.1;

interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * A view as the lab's Debug export writes it: degrees, the altitude over
 * the ellipsoid in km, the heading from north toward east, the pitch above
 * the local horizontal.
 */
export interface GlobeViewPose {
  readonly lat: number;
  readonly lng: number;
  readonly altitudeKm: number;
  readonly headingDeg: number;
  readonly pitchDeg: number;
}

/** What the view reads from the page every frame (the lab's hash). */
export interface GlobeViewSettings {
  /** The page's field of view (deg): the fit is made for it. */
  readonly fovY: number;
  /** 1: the world frame follows the target; else the world is ECEF. */
  readonly worldFrame: number;
  /** 0: no sky pass (and no `afterSky`). */
  readonly sky: number;
  /** Navy space's strength (0 is black). */
  readonly space: number;
  /** 1: clear magenta, so an unfilled pixel shows. */
  readonly holeColor: number;
  /** The clouds' drift far out (deg/s), its far altitude and the wind. */
  readonly cloudDrift: number;
  readonly cloudDriftFarKm: number;
  readonly cloudWindMps: number;
}

/**
 * The page's parts of the frame, in the frame's order. Every seam is
 * optional; each is called at the place the lab's frame did that work.
 */
export interface GlobeViewSeams {
  /** First, before anything (the recorders' frame start). */
  frameStart?(nowMs: number): void;
  /** True: the frame does nothing but start and end (a calibration). */
  paused?(): boolean;
  /** After the fit and the sun: whoever places the camera does it here. */
  driveCamera?(nowMs: number): void;
  /** After the camera: the page's layers, their per-frame state. */
  update?(nowMs: number): void;
  /** After the sky pass, inside it (only with `sky`): the page's air. */
  afterSky?(): void;
  /** Just before the scene is drawn. */
  beforeScene?(): void;
  /** Just after the scene is drawn. */
  afterScene?(): void;
  /** Last. */
  frameEnd?(nowMs: number): void;
  /** The world frame moved (the target, or null for ECEF). */
  frameChanged?(target: LatLng | null): void;
  /** True while a gesture holds the camera: no recentre then. */
  gestureBusy?(): boolean;
}

/** The sun's angles at an instant and a place (the framework's ephemeris). */
type SolarPositionAt = (
  ms: number,
  latDeg: number,
  lngDeg: number,
) => { readonly elevationRad: number; readonly azimuthRad: number };

export interface GlobeViewOptions {
  readonly canvas: HTMLCanvasElement;
  /** The camera's field of view at creation (deg). */
  readonly fovYDeg: number;
  readonly settings: () => GlobeViewSettings;
  readonly solarPosition: SolarPositionAt;
  /** A stencil buffer (the relief's stencil fill needs one). */
  readonly stencil?: boolean;
  /** The reversed depth buffer (first person). */
  readonly reversedDepth?: boolean;
  /** The surface's map loader (default: the surface's own). */
  readonly mapLoader?: GlobeSurfaceLoader;
  /** The surface compiles the relief's band, and its stencil fill. */
  readonly band?: boolean;
  readonly fill?: boolean;
  readonly seams?: GlobeViewSeams;
  /** Tests: the renderer, and the monotonic clock (`performance.now`). */
  readonly createRenderer?: (
    parameters: THREE.WebGLRendererParameters,
  ) => THREE.WebGLRenderer;
  readonly monoNow?: () => number;
}

interface GlobeViewState {
  /** When the last frame ran (the monotonic clock), 0 before one. */
  readonly frameAt: number;
  /** How many times the frame has recentred under the camera. */
  readonly frameRecentres: number;
  readonly siderealAngleRad: number;
  /** The clouds' drift rate at the camera's altitude (deg/s). */
  readonly cloudDriftRate: number;
}

export interface GlobeView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly sky: GlobeSky;
  readonly globe: GlobeSurface;
  /** The ellipsoid's equatorial radius (m). */
  readonly radius: number;
  /** The camera's pose in ECEF, through the frame. */
  ecefCamera(): EcefPose;
  /** Places the camera at an ECEF pose, through the frame. */
  placeCameraEcef(position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  /** The world frame's target, or null in ECEF. */
  frameTarget(): LatLng | null;
  /** Moves the world frame to `target` (null: ECEF), the view unchanged. */
  setFrameTarget(target: LatLng | null): void;
  /** Moves the frame under a camera flown far from it (not in a gesture). */
  recentreFrame(): void;
  /** The frame at the view's place, then the camera at the view. */
  placeView(view: GlobeViewPose): void;
  /** The Earth's centre in the world (ECEF's origin through the frame). */
  earthCentreWorld(): THREE.Vector3;
  /** The orbit distance that fits the globe at the page's fovY. */
  fitDistance(): number;
  /** Refits the buffer and the camera on the next frame. */
  refit(): void;
  /** (Re)starts the clock; the clouds keep their offset. */
  startClock(setting: GlobeClockSetting): void;
  clock(): GlobeClock;
  /** The scene's instant now (epoch ms). */
  sceneMs(): number;
  /** The next frame seeds the clouds where rate x time puts them. */
  resetCloudDrift(): void;
  /** The sun and the clouds' drift at the clock's instant; returns it. */
  sunNow(): number;
  /** One frame. */
  frame(): void;
  state(): GlobeViewState;
}

/**
 * The ECEF pose of a view: at its altitude over the ellipsoid, looking
 * along its heading and pitch, the local up as the camera's up. RangeError
 * for a value that is not finite.
 */
export function viewPoseEcef(
  ellipsoid: Ellipsoid,
  view: GlobeViewPose,
): EcefPose {
  const { lat, lng, altitudeKm, headingDeg, pitchDeg } = view;
  const values = [lat, lng, altitudeKm, headingDeg, pitchDeg];
  if (!values.every(Number.isFinite)) {
    throw new RangeError(`a view needs finite values, got ${values.join(",")}`);
  }
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
  return {
    position,
    quaternion: new THREE.Quaternion().setFromRotationMatrix(look),
  };
}

export function createGlobeView(options: GlobeViewOptions): GlobeView {
  const { canvas, settings, solarPosition } = options;
  const seams = options.seams ?? {};
  const monoNow = options.monoNow ?? (() => performance.now());
  const makeRenderer =
    options.createRenderer ??
    ((parameters: THREE.WebGLRendererParameters) =>
      new THREE.WebGLRenderer(parameters));
  const renderer = makeRenderer({
    canvas,
    antialias: true,
    stencil: options.stencil === true,
    reversedDepthBuffer: options.reversedDepth === true,
  });
  // Neutral tone mapping (the look-dev default), no ambient light, a black
  // sky; the frame clears once, then draws the sky pass, then the Earth.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.autoClear = false;
  const sky = createGlobeSky();
  const sunWorld = new THREE.Vector3();
  const earthDirection = new THREE.Vector3();
  const celestial = new THREE.Quaternion();
  let siderealAngleRad = 0;
  const scene = new THREE.Scene();
  // The ellipsoid's equatorial radius (the tiles' own WGS84).
  const radius = WGS84_ELLIPSOID.radius.x;
  const camera = new THREE.PerspectiveCamera(
    options.fovYDeg,
    1,
    radius * 0.01,
    radius * 20,
  );
  let distance = radius * 3;
  let fittedSize = "";
  let frameAt = 0;
  const globe = createGlobeSurface(options.mapLoader, {
    band: options.band === true,
    // A globe that fills the relief's gaps never discards: its program
    // keeps the GPU's early stencil test.
    fill: options.fill === true,
  });
  scene.add(globe.group);

  // The world frame: one matrix on globe.group, from ECEF to the target's
  // local frame (x east, y up, the origin on the ground), or the identity
  // before any target. Every camera pose is written and read in ECEF
  // through it, never by assuming world = ECEF.
  const worldFrame: { matrix: THREE.Matrix4; target: LatLng | null } = {
    matrix: new THREE.Matrix4(),
    target: null,
  };
  globe.group.matrixAutoUpdate = false;
  const ecefCamera = () => ecefPoseOf(camera, worldFrame.matrix);
  const placeCameraEcef = (
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ) => applyEcefPose(camera, { position, quaternion }, worldFrame.matrix);
  const sameTarget = (a: LatLng | null, b: LatLng | null) =>
    a?.lat === b?.lat && a?.lng === b?.lng;
  const setFrameTarget = (target: LatLng | null) => {
    const next = settings().worldFrame === 1 && target ? target : null;
    if (sameTarget(next, worldFrame.target)) return;
    const before = ecefCamera();
    if (next) worldFromEcefAt(globe.tiles.ellipsoid, next, worldFrame.matrix);
    else worldFrame.matrix.identity();
    worldFrame.target = next ? { lat: next.lat, lng: next.lng } : null;
    globe.group.matrix.copy(worldFrame.matrix);
    globe.group.matrixWorldNeedsUpdate = true;
    globe.group.updateMatrixWorld(true);
    applyEcefPose(camera, before, worldFrame.matrix);
    seams.frameChanged?.(worldFrame.target);
  };
  let frameRecentres = 0;
  /**
   * Moves the frame under the camera once it has flown too far from the
   * frame's origin (`frameRecentreTarget`): a frame left 244 km behind
   * stood 4.7 km off the curved ground, and the cloud deck, flat in the
   * frame, floated above the camera. Never under a gesture: a frame move
   * releases the controls.
   */
  const recentreFrame = () => {
    if (worldFrame.target === null || seams.gestureBusy?.() === true) return;
    const ellipsoid = globe.tiles.ellipsoid;
    const c = ellipsoid.getPositionToCartographic(ecefCamera().position, {
      lat: 0,
      lon: 0,
      height: 0,
    });
    const next = frameRecentreTarget(
      ellipsoid,
      worldFrame.target,
      { lat: c.lat / DEG, lng: c.lon / DEG },
      c.height,
    );
    if (next) {
      frameRecentres += 1;
      setFrameTarget(next);
    }
  };
  const earthCentre = new THREE.Vector3();
  const earthCentreWorld = () =>
    earthCentre.setFromMatrixPosition(globe.group.matrixWorld);

  // The clock (started by the page) and the clouds' offset, summed per
  // frame at the rate for the camera's altitude: rate x time would jump
  // the clouds at every change of height. Seeded at the far rate.
  let clock: GlobeClock | null = null;
  const theClock = () => {
    if (clock === null) throw new Error("the view's clock is not started");
    return clock;
  };
  const cloudDrift: { offset: number | null; atMs: number; rate: number } = {
    offset: null,
    atMs: 0,
    rate: 0,
  };
  const driftClouds = (mono: number) => {
    const p = settings();
    const t = theClock().driftTimeAt(mono);
    const altitudeM = globe.tiles.ellipsoid.getPositionElevation(
      ecefCamera().position,
    );
    cloudDrift.rate = cloudDriftDegPerS(altitudeM, {
      farDegPerS: p.cloudDrift,
      farM: p.cloudDriftFarKm * 1000,
      windMps: p.cloudWindMps,
    });
    cloudDrift.offset =
      cloudDrift.offset === null
        ? cloudLonOffsetRad(t, p.cloudDrift)
        : advanceCloudLonOffsetRad(
            cloudDrift.offset,
            (t - cloudDrift.atMs) / 1000,
            cloudDrift.rate,
          );
    cloudDrift.atMs = t;
    return cloudDrift.offset;
  };
  /**
   * Everything the clock drives, at its instant: the sun (it moves 0.25° a
   * minute), the clouds' drift (on the clock's DRIFT time, so a fast clock
   * does not strobe them) and the stars' sidereal angle.
   */
  const sunNow = () => {
    const mono = monoNow();
    const ms = theClock().timeAt(mono);
    globe.setSun(
      sunDirectionEcef(globe.tiles.ellipsoid, solarPosition(ms, 0, 0)),
    );
    globe.surfaceUniforms.uCloudLonOffset.value = driftClouds(mono);
    siderealAngleRad = greenwichSiderealAngleRad(ms);
    return ms;
  };

  const fit = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Both sides: a phone's URL bar changes only the height.
    if (`${w}x${h}` === fittedSize) return;
    fittedSize = `${w}x${h}`;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // At the page's field of view, not the camera's: the fly-in varies
    // the camera's on the way.
    distance = orbitDistanceToFit({
      fovYRad: settings().fovY * DEG,
      aspect: camera.aspect,
      margin: FIT_MARGIN,
      radius,
    });
  };

  /** The sky pass: the sun, the stars by sidereal time, navy space. */
  const drawSky = () => {
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
      strength: settings().space,
      earthDirection,
      earthAngularRadiusRad: Math.asin(
        Math.min(1, radius / Math.max(cameraDistance, radius)),
      ),
    });
    sky.render(renderer, camera);
  };

  /** The clear (magenta with holeColor 1), then the sky pass with sky. */
  const clearAndSky = () => {
    const p = settings();
    renderer.setClearColor(p.holeColor === 1 ? 0xff00ff : 0x000000);
    renderer.clear();
    if (p.sky === 0) return;
    drawSky();
    seams.afterSky?.();
  };

  const frame = () => {
    seams.frameStart?.(monoNow());
    if (seams.paused?.() === true) {
      seams.frameEnd?.(monoNow());
      return;
    }
    fit();
    sunNow();
    const now = monoNow();
    frameAt = now;
    seams.driveCamera?.(now);
    seams.update?.(now);
    clearAndSky();
    seams.beforeScene?.();
    renderer.render(scene, camera);
    seams.afterScene?.();
    seams.frameEnd?.(monoNow());
  };

  return {
    renderer,
    scene,
    camera,
    sky,
    globe,
    radius,
    ecefCamera,
    placeCameraEcef,
    frameTarget: () => worldFrame.target,
    setFrameTarget,
    recentreFrame,
    placeView(view) {
      const pose = viewPoseEcef(globe.tiles.ellipsoid, view);
      setFrameTarget({ lat: view.lat, lng: view.lng });
      placeCameraEcef(pose.position, pose.quaternion);
    },
    earthCentreWorld,
    fitDistance: () => distance,
    refit() {
      fittedSize = "";
    },
    startClock(setting) {
      clock = startGlobeClock(setting, {
        epochMs: Date.now(),
        monoMs: monoNow(),
      });
    },
    clock: theClock,
    sceneMs: () => theClock().timeAt(monoNow()),
    resetCloudDrift() {
      cloudDrift.offset = null;
    },
    sunNow,
    frame,
    state: () => ({
      frameAt,
      frameRecentres,
      siderealAngleRad,
      cloudDriftRate: cloudDrift.rate,
    }),
  };
}
