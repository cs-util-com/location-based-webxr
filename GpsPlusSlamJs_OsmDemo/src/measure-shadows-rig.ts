/**
 * The building-shadow spike's controller (`?measure=shadows`, throwaway):
 * cached sun shadows on the city, either ONE map fitted to the whole city
 * or a NEAR map on the sun light (fitted to the camera distance, snapped to
 * its texel grid, following the orbit target) plus a FAR map on a
 * zero-intensity light over the whole city. Every knob the spike sweeps is
 * a field of `SpikeConfig`.
 *
 * @see measure-shadows-rig.ts.md
 */

import * as THREE from "three";

/** One configuration of the spike. */
export interface SpikeConfig {
  /** `one`: a single map over the city; `two`: near plus far. */
  readonly shape: "one" | "two";
  /** The near map's size (or the single map's). */
  readonly nearSize: number;
  /** The far map's size. */
  readonly farSize: number;
  /** Near half width = k x camera distance, clamped and quantised. */
  readonly k: number;
  /** The near map re-centres past this fraction of its half width. */
  readonly recentreFraction: number;
  /** Near re-centres only once no pan input came for this long (null: on every re-centre). */
  readonly settleMs: number | null;
  /** Near and far in alternate frames. */
  readonly split: boolean;
  /** A sun move under this re-renders nothing. */
  readonly sunUpdateDeg: number;
  /** At most one sun-step render per this many ms (0: every step). */
  readonly cadenceMs: number;
  readonly floorDeg: number;
  readonly fullDeg: number;
  /** The near map's depth fade starts this fraction of R past the centre. */
  readonly fadeF: number;
}

export const SPIKE_DEFAULT: SpikeConfig = {
  shape: "two",
  nearSize: 2048,
  farSize: 2048,
  k: 1,
  recentreFraction: 0.25,
  settleMs: null,
  split: false,
  sunUpdateDeg: 0.05,
  cadenceMs: 0,
  floorDeg: 2,
  fullDeg: 8,
  fadeF: 0.9,
};

/** The loaded city: its centre on the ground, half width and tallest caster. */
export interface SpikeWorld {
  readonly centre: THREE.Vector3;
  readonly halfExtentM: number;
  readonly maxHeightM: number;
}

/** What one update reads from the view. */
export interface SpikeInputs {
  /** Unit vector toward the sun. */
  readonly sunDir: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly cameraDistanceM: number;
  readonly nowMs: number;
  /** A pan input came within `settleMs`. */
  readonly panning: boolean;
  /** Render a deferred sun step now (the cadence's trailing render). */
  readonly trailing?: boolean;
}

/** What one update did. */
export interface SpikeUpdate {
  readonly near: boolean;
  readonly far: boolean;
  /** A map waits for the next frame (split frames). */
  readonly again: boolean;
}

const DEG = Math.PI / 180;
const MARGIN_M = 30;
const NEAR_STEPS = [120, 170, 240, 340, 480, 600];
const NONE: SpikeUpdate = { near: false, far: false, again: false };

/** k x distance, clamped to [120, 600] and quantised to sqrt(2) steps. */
export function nearHalfWidth(distanceM: number, k: number): number {
  const wanted = k * distanceM;
  for (const step of NEAR_STEPS) if (step >= wanted) return step;
  return NEAR_STEPS[NEAR_STEPS.length - 1]!;
}

/** 0 at and below the floor, 1 at and above full, linear between. */
function rampStrength(elevationDeg: number, c: SpikeConfig): number {
  if (elevationDeg <= c.floorDeg) return 0;
  if (elevationDeg >= c.fullDeg) return 1;
  return (elevationDeg - c.floorDeg) / (c.fullDeg - c.floorDeg);
}

const UP = new THREE.Vector3(0, 1, 0);

/** The light camera's lateral axes, as three's `lookAt` builds them. */
function lightAxes(sunDir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const x = new THREE.Vector3().crossVectors(UP, sunDir).normalize();
  const y = new THREE.Vector3().crossVectors(sunDir, x);
  return [x, y];
}

/** The centre moved onto the light-space texel grid (depth unchanged). */
function snapCentre(
  centre: THREE.Vector3,
  sunDir: THREE.Vector3,
  halfWidthM: number,
  mapSize: number,
): THREE.Vector3 {
  const texel = (2 * halfWidthM) / mapSize;
  const out = centre.clone();
  for (const axis of lightAxes(sunDir)) {
    const u = centre.dot(axis);
    out.addScaledVector(axis, Math.round(u / texel) * texel - u);
  }
  return out;
}

function boxDistance(
  centre: THREE.Vector3,
  sunDir: THREE.Vector3,
  world: SpikeWorld,
): number {
  let best = 0;
  const e = world.halfExtentM;
  const corner = new THREE.Vector3();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const y of [0, world.maxHeightM]) {
        corner.set(world.centre.x + sx * e, y, world.centre.z + sz * e);
        best = Math.max(best, corner.sub(centre).dot(sunDir));
      }
    }
  }
  return best + MARGIN_M;
}

/** The farthest loaded caster toward the sun, capped by the longest shadow. */
function casterDistance(
  centre: THREE.Vector3,
  sunDir: THREE.Vector3,
  halfWidthM: number,
  world: SpikeWorld,
  floorDeg: number,
): number {
  const box = boxDistance(centre, sunDir, world);
  const cap =
    halfWidthM * Math.SQRT2 +
    world.maxHeightM / Math.tan(Math.max(0.5, floorDeg) * DEG) +
    MARGIN_M;
  return Math.max(halfWidthM + MARGIN_M, Math.min(box, cap));
}

interface Rendered {
  readonly sunDir: THREE.Vector3;
  readonly centre: THREE.Vector3;
  readonly halfWidthM: number;
  readonly distanceM: number;
}

function angleDeg(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) / DEG;
}

function setMapSize(light: THREE.DirectionalLight, size: number): void {
  if (light.shadow.mapSize.x === size && light.shadow.mapSize.y === size) {
    return;
  }
  light.shadow.map?.dispose();
  light.shadow.map = null;
  light.shadow.mapSize.set(size, size);
}

function placeLight(
  light: THREE.DirectionalLight,
  centre: THREE.Vector3,
  sunDir: THREE.Vector3,
  distanceM: number,
): void {
  light.position.copy(centre).addScaledVector(sunDir, distanceM);
  light.target.position.copy(centre);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
}

function setBounds(
  light: THREE.DirectionalLight,
  halfWidthM: number,
  farM: number,
  mapSize: number,
): void {
  const camera = light.shadow.camera;
  camera.left = -halfWidthM;
  camera.right = halfWidthM;
  camera.top = halfWidthM;
  camera.bottom = -halfWidthM;
  camera.near = 0;
  camera.far = farM;
  camera.updateProjectionMatrix();
  light.shadow.bias = 0;
  light.shadow.normalBias = (2 * halfWidthM) / mapSize;
  light.shadow.needsUpdate = true;
}

/** The spike's two lights and their cached maps. */
export class SpikeShadows {
  readonly farLight = new THREE.DirectionalLight(0xffffff, 0);
  nearRenders = 0;
  farRenders = 0;
  private near: Rendered | undefined;
  private far: Rendered | undefined;
  private pendingFar = false;
  private lastSunRenderMs = Number.NEGATIVE_INFINITY;
  private on = false;

  constructor(
    private readonly sun: THREE.DirectionalLight,
    private readonly scene: THREE.Scene,
    public world: SpikeWorld,
    public config: SpikeConfig = SPIKE_DEFAULT,
  ) {
    this.farLight.name = "spike-far-shadow";
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Casting on in the current shape; the next update renders every map. */
  enable(): void {
    this.on = true;
    this.sun.castShadow = true;
    this.sun.shadow.autoUpdate = false;
    setMapSize(this.sun, this.config.nearSize);
    this.applyShape();
    this.forget();
  }

  /** Casting off, the far light out of the scene: the shadow-free programs. */
  disable(): void {
    this.on = false;
    this.sun.castShadow = false;
    this.sun.shadow.intensity = 1;
    this.farLight.castShadow = false;
    this.scene.remove(this.farLight, this.farLight.target);
    this.forget();
  }

  /** A new configuration; map sizes reallocate, the next update renders. */
  configure(config: SpikeConfig): void {
    this.config = config;
    if (!this.on) return;
    setMapSize(this.sun, config.nearSize);
    this.applyShape();
    this.forget();
  }

  /** The next update renders every map. */
  forget(): void {
    this.near = undefined;
    this.far = undefined;
    this.pendingFar = false;
    this.lastSunRenderMs = Number.NEGATIVE_INFINITY;
  }

  /** Bytes of shadow maps this configuration holds (8 B per texel). */
  bytes(): number {
    const near = this.config.nearSize ** 2;
    const far = this.config.shape === "two" ? this.config.farSize ** 2 : 0;
    return 8 * (near + far);
  }

  /** One frame's decision, applied: which maps render in this frame. */
  update(inputs: SpikeInputs): SpikeUpdate {
    if (!this.on) return NONE;
    const elevationDeg = Math.asin(inputs.sunDir.y) / DEG;
    this.sun.shadow.intensity = rampStrength(elevationDeg, this.config);
    if (elevationDeg < this.config.floorDeg) {
      this.follow(inputs.sunDir, inputs.target);
      return NONE;
    }
    const near = this.nearNeeds(inputs);
    const far = this.farNeeds(inputs);
    if (near || far) this.lastSunRenderMs = inputs.nowMs;
    const deferFar = this.config.split && near && far;
    if (near) this.renderNear(inputs);
    else this.follow(inputs.sunDir, inputs.target);
    if (far && !deferFar) this.renderFar(inputs);
    this.pendingFar = deferFar || (this.pendingFar && !far);
    return { near, far: far && !deferFar, again: deferFar };
  }

  private applyShape(): void {
    const two = this.config.shape === "two";
    this.farLight.castShadow = two;
    this.farLight.shadow.autoUpdate = false;
    setMapSize(this.farLight, this.config.farSize);
    if (two) this.scene.add(this.farLight, this.farLight.target);
    else this.scene.remove(this.farLight, this.farLight.target);
  }

  private cadenceAllows(inputs: SpikeInputs): boolean {
    if (inputs.trailing === true) return true;
    return inputs.nowMs - this.lastSunRenderMs >= this.config.cadenceMs;
  }

  private sunMoved(last: Rendered, inputs: SpikeInputs): boolean {
    return (
      angleDeg(last.sunDir, inputs.sunDir) > this.config.sunUpdateDeg &&
      this.cadenceAllows(inputs)
    );
  }

  private nearHalfWidth(inputs: SpikeInputs): number {
    return this.config.shape === "one"
      ? this.world.halfExtentM
      : nearHalfWidth(inputs.cameraDistanceM, this.config.k);
  }

  private nearNeeds(inputs: SpikeInputs): boolean {
    const last = this.near;
    if (last === undefined) return true;
    if (this.sunMoved(last, inputs)) return true;
    if (this.config.shape === "one") return false;
    if (last.halfWidthM !== this.nearHalfWidth(inputs)) return true;
    if (this.config.settleMs !== null && inputs.panning) return false;
    const drift = Math.hypot(
      inputs.target.x - last.centre.x,
      inputs.target.z - last.centre.z,
    );
    return drift > this.config.recentreFraction * last.halfWidthM;
  }

  private farNeeds(inputs: SpikeInputs): boolean {
    if (this.config.shape === "one") return false;
    if (this.pendingFar) return true;
    const last = this.far;
    return last === undefined || this.sunMoved(last, inputs);
  }

  private renderNear(inputs: SpikeInputs): void {
    const one = this.config.shape === "one";
    const R = this.nearHalfWidth(inputs);
    const size = this.config.nearSize;
    const centre = one
      ? this.world.centre.clone()
      : snapCentre(inputs.target, inputs.sunDir, R, size);
    const D = one
      ? boxDistance(centre, inputs.sunDir, this.world)
      : casterDistance(
          centre,
          inputs.sunDir,
          R,
          this.world,
          this.config.floorDeg,
        );
    const farM = one ? 2 * D + R : (D + this.config.fadeF * R) / 0.98;
    placeLight(this.sun, centre, inputs.sunDir, D);
    setBounds(this.sun, R, farM, size);
    this.near = {
      sunDir: inputs.sunDir.clone(),
      centre,
      halfWidthM: R,
      distanceM: D,
    };
    this.nearRenders += 1;
  }

  private renderFar(inputs: SpikeInputs): void {
    const R = this.world.halfExtentM;
    const centre = this.world.centre.clone();
    const D = boxDistance(centre, inputs.sunDir, this.world);
    placeLight(this.farLight, centre, inputs.sunDir, D);
    setBounds(this.farLight, R, 2 * D + R, this.config.farSize);
    this.far = {
      sunDir: inputs.sunDir.clone(),
      centre,
      halfWidthM: R,
      distanceM: D,
    };
    this.farRenders += 1;
  }

  /** Between renders the sun light follows the current sun. */
  private follow(sunDir: THREE.Vector3, fallback: THREE.Vector3): void {
    const at = this.near?.centre ?? fallback;
    const D = this.near?.distanceM ?? 1000;
    placeLight(this.sun, at, sunDir, D);
  }
}
