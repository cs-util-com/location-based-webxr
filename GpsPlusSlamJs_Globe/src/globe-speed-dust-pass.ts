/**
 * The speed dust's drawing pass (round-3 plan 2026-10-08-2345, D1; the
 * pure model is `globe-speed-dust.ts`), moved out of the globe lab so the
 * Tour Viewer's editor draws the same streaks: streaks pouring past the
 * camera, drawn as instanced quads in a scene of their own with a camera
 * that has the view's ECEF orientation at the origin, so the field lives
 * in ECEF axes and a world-frame recentre never spins it. Additive, no
 * depth: a page draws it before the Earth (which covers it) at 1 - `over`
 * and after it at `over`.
 *
 * @see globe-speed-dust-pass.ts.md
 */
import * as THREE from "three";

import {
  GLOBE_SPEED_DUST,
  advanceField,
  createSpeedField,
  driftRate,
  speedDustOpacity,
  speedShare,
  startVelocity,
  stepVelocity,
  streaks,
} from "./globe-speed-dust.js";

const VERTEX = /* glsl */ `
attribute vec3 aHead;
attribute vec3 aTail;
attribute float aAlpha;
uniform float uWidthPx;
uniform vec2 uViewport;
varying float vAlpha;
varying float vAlong;
void main() {
  vec4 h = projectionMatrix * modelViewMatrix * vec4(aHead, 1.0);
  vec4 t = projectionMatrix * modelViewMatrix * vec4(aTail, 1.0);
  const float NEAR_W = 0.02;
  vAlong = position.x;
  if (h.w <= NEAR_W) {
    // Behind the camera: nothing (the near fade makes these dark anyway).
    vAlpha = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // A tail behind the camera is clipped to the near plane along the streak.
  if (t.w < NEAR_W) t = mix(h, t, (h.w - NEAR_W) / max(h.w - t.w, 1e-6));
  vec2 hs = h.xy / h.w * uViewport * 0.5;
  vec2 ts = t.xy / t.w * uViewport * 0.5;
  vec2 d = ts - hs;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 across = vec2(-dir.y, dir.x);
  // At least as long as wide: a slow streak is a dot, not nothing.
  vec2 p = hs + dir * position.x * max(len, uWidthPx)
    + across * position.y * uWidthPx * 0.5;
  float w = mix(h.w, t.w, position.x);
  gl_Position = vec4(p / (uViewport * 0.5) * w, 0.0, w);
  // Long streaks spread their light: the same energy as a dot, at least.
  vAlpha = aAlpha * clamp(sqrt(uWidthPx / max(len, uWidthPx)), 0.15, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uWeight;
uniform float uGain;
uniform vec3 uColor;
varying float vAlpha;
varying float vAlong;
void main() {
  // Brightest at the head, fading along the trail.
  float a = vAlpha * uWeight * uGain * (1.0 - 0.85 * vAlong);
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

/** The most streaks the pass holds (the lab panel's `dustCount` maximum). */
export const SPEED_DUST_MAX_COUNT = 4000;

/**
 * The look the lab and the editor draw when the dust is on: the owner's
 * pick of four A/B looks (DEC-R3-17, 2026-10-09, look C) - 2,500 streaks,
 * a 60 ms exposure, gain 2 - at 1.5 px wide, a quarter of it over the
 * Earth (`over`; the rest behind it).
 */
export const SPEED_DUST_LOOK = Object.freeze({
  count: 2500,
  gain: 2,
  exposureMs: 60,
  widthPx: 1.5,
  over: 0.25,
});

/** The streaks' tints (`dustColor`, D1b): bluish white, white, warm. */
export const SPEED_DUST_COLORS: readonly (readonly [number, number, number])[] =
  Object.freeze([
    [0.85, 0.9, 1.0],
    [1.0, 1.0, 1.0],
    [1.0, 0.85, 0.65],
  ]);

/** The look's knobs, each the default when absent (the lab's panel, D1b). */
export interface SpeedDustKnobs {
  readonly count?: number;
  /** On the opacity (default 1; a negative value reads as 1). */
  readonly gain?: number;
  /** The model's far-out share, 0..1. */
  readonly farShare?: number;
  /** An index into `SPEED_DUST_COLORS`. */
  readonly color?: number;
  readonly loMps?: number;
  readonly hiMps?: number;
  readonly driftMin?: number;
  readonly driftMax?: number;
}

/** What the pass needs of the renderer. */
export type SpeedDustRenderer = Pick<
  THREE.WebGLRenderer,
  "getDrawingBufferSize" | "getPixelRatio" | "render"
>;

/** One frame's input to `update`. */
export interface SpeedDustFrame {
  readonly nowMs: number;
  /** The camera's ECEF position (m) and orientation. */
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Its altitude over the ellipsoid (m). */
  readonly altitudeM: number;
  /** Its vertical field of view (deg) and aspect. */
  readonly fovDeg: number;
  readonly aspect: number;
  readonly renderer: SpeedDustRenderer;
  /** Off: the speed is still measured, nothing is drawn. */
  readonly on: boolean;
  /** The streaks' exposure (ms; at least a frame) and width (CSS px). */
  readonly exposureMs: number;
  readonly widthPx: number;
  /** Only the motion toward or away from the centre makes streaks. */
  readonly radialOnly?: boolean;
  readonly look?: SpeedDustKnobs;
}

/** The pass's state after its last `update` (the knobs as applied). */
export interface SpeedDustState {
  readonly count: number;
  readonly gain: number;
  readonly farShare: number;
  readonly color: number;
  readonly loMps: number;
  readonly hiMps: number;
  readonly driftMin: number;
  readonly driftMax: number;
  readonly speedMps: number;
  readonly share: number;
  readonly opacity: number;
  readonly drift: number;
  readonly direction: readonly [number, number, number];
  readonly shown: boolean;
}

/** The first visible streaks, projected (`sample`). */
export interface SpeedDustSample {
  /** Heads and tails as normalised screen points, 0 at the top-left. */
  readonly streaks: readonly {
    readonly head: readonly [number, number];
    readonly tail: readonly [number, number];
    readonly alpha: number;
  }[];
  /** Where the motion points on screen, or null behind the camera. */
  readonly focus: readonly [number, number] | null;
}

export interface SpeedDustPass {
  /** Forget the velocity (the camera was placed, not flown). */
  reset(): void;
  /** This frame: steps the velocity, the field and the streaks. */
  update(frame: SpeedDustFrame): void;
  /** Draws the streaks at `weight` (no-op when not shown or weight 0). */
  render(renderer: SpeedDustRenderer, weight: number): void;
  state(): SpeedDustState;
  sample(n?: number): SpeedDustSample;
  dispose(): void;
}

/**
 * A knob's range, or the default when it is not a positive, rising pair
 * (a pasted link with crossed ranges falls back instead of throwing on
 * every frame: the F1b/D1b milestone review).
 */
function rangeOr(
  givenLo: number | undefined,
  givenHi: number | undefined,
  fallbackLo: number,
  fallbackHi: number,
): [number, number] {
  const lo = givenLo ?? fallbackLo;
  const hi = givenHi ?? fallbackHi;
  return lo > 0 && hi > lo && Number.isFinite(hi)
    ? [lo, hi]
    : [fallbackLo, fallbackHi];
}

type Rgb = readonly [number, number, number];

/** The knobs a frame resolves to, defaults filled in and ranges checked. */
interface ResolvedLook {
  readonly count: number;
  readonly gain: number;
  readonly farShare: number;
  readonly color: number;
  readonly rgb: Rgb;
  readonly loMps: number;
  readonly hiMps: number;
  readonly driftMin: number;
  readonly driftMax: number;
}

/** The colour index and its tint; an unknown index reads as the first. */
function tintOf(index: number | undefined): { color: number; rgb: Rgb } {
  const tint = index === undefined ? undefined : SPEED_DUST_COLORS[index];
  if (tint === undefined || index === undefined) {
    return { color: 0, rgb: SPEED_DUST_COLORS[0] ?? [1, 1, 1] };
  }
  return { color: index, rgb: tint };
}

function resolveLook(look: SpeedDustKnobs, maxCount: number): ResolvedLook {
  const [loMps, hiMps] = rangeOr(
    look.loMps,
    look.hiMps,
    GLOBE_SPEED_DUST.loMps,
    GLOBE_SPEED_DUST.hiMps,
  );
  const [driftMin, driftMax] = rangeOr(
    look.driftMin,
    look.driftMax,
    GLOBE_SPEED_DUST.driftMin,
    GLOBE_SPEED_DUST.driftMax,
  );
  const wanted = look.count ?? SPEED_DUST_LOOK.count;
  const farShare = look.farShare;
  return {
    count: Math.round(Math.min(Math.max(wanted, 1), maxCount)),
    gain: look.gain !== undefined && look.gain >= 0 ? look.gain : 1,
    farShare:
      farShare !== undefined && farShare >= 0 && farShare <= 1
        ? farShare
        : GLOBE_SPEED_DUST.farShare,
    ...tintOf(look.color),
    loMps,
    hiMps,
    driftMin,
    driftMax,
  };
}

/** The unit vector of `v` (zero for a zero vector) and its length. */
function directionOf(v: readonly number[]): {
  speedMps: number;
  dir: [number, number, number];
} {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  const speedMps = Math.hypot(x, y, z);
  return {
    speedMps,
    dir: speedMps > 0 ? [x / speedMps, y / speedMps, z / speedMps] : [0, 0, 0],
  };
}

const outside = (v: number, lo: number, hi: number): boolean =>
  v < lo || v > hi;

/**
 * The pass: `update(...)` each frame with the camera's ECEF pose, then
 * `render(renderer, weight)`; `reset()` where the page places the camera;
 * `state()` for the checks; `sample(n)` the first n visible streaks
 * projected. The field holds `maxCount` seeds; the `count` knob draws a
 * prefix of them (a prefix of a uniform field is uniform), so the count is
 * a live knob (D1b).
 */
export function createSpeedDustPass(
  maxCount = SPEED_DUST_MAX_COUNT,
): SpeedDustPass {
  const all = createSpeedField(maxCount);
  let count = Math.min(SPEED_DUST_LOOK.count, maxCount);
  let seeds = all.subarray(0, count * 3);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const heads = new THREE.InstancedBufferAttribute(
    new Float32Array(maxCount * 3),
    3,
  );
  const tails = new THREE.InstancedBufferAttribute(
    new Float32Array(maxCount * 3),
    3,
  );
  const alphas = new THREE.InstancedBufferAttribute(
    new Float32Array(maxCount),
    1,
  );
  geometry.setAttribute("aHead", heads);
  geometry.setAttribute("aTail", tails);
  geometry.setAttribute("aAlpha", alphas);
  geometry.instanceCount = count;
  const [r0, g0, b0] = SPEED_DUST_COLORS[0] ?? [1, 1, 1];
  const uniforms = {
    uWidthPx: { value: 1.5 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uWeight: { value: 1 },
    uGain: { value: 1 },
    uColor: { value: new THREE.Vector3(r0, g0, b0) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const dustScene = new THREE.Scene();
  dustScene.add(mesh);
  const dustCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
  const size = new THREE.Vector2();
  let velocity = startVelocity();
  let offset: [number, number, number] = [0, 0, 0];
  let lastMs: number | null = null;
  let report: SpeedDustState = {
    count,
    gain: 1,
    farShare: GLOBE_SPEED_DUST.farShare,
    color: 0,
    loMps: GLOBE_SPEED_DUST.loMps,
    hiMps: GLOBE_SPEED_DUST.hiMps,
    driftMin: GLOBE_SPEED_DUST.driftMin,
    driftMax: GLOBE_SPEED_DUST.driftMax,
    speedMps: 0,
    share: 0,
    opacity: 0,
    drift: 0,
    direction: [0, 0, 0],
    shown: false,
  };

  return {
    reset() {
      velocity = startVelocity();
      lastMs = null;
    },
    update({
      nowMs,
      position,
      quaternion,
      altitudeM,
      fovDeg,
      aspect,
      renderer,
      on,
      exposureMs,
      widthPx,
      radialOnly = false,
      look = {},
    }) {
      const { rgb, ...knobs } = resolveLook(look, maxCount);
      const { gain, farShare, loMps, hiMps, driftMin, driftMax } = knobs;
      if (knobs.count !== count) {
        count = knobs.count;
        seeds = all.subarray(0, count * 3);
        geometry.instanceCount = count;
      }
      uniforms.uGain.value = gain;
      uniforms.uColor.value.set(rgb[0], rgb[1], rgb[2]);
      velocity = stepVelocity(
        velocity,
        [position.x, position.y, position.z],
        nowMs,
        altitudeM,
        { radialOnly },
      );
      const { speedMps, dir } = directionOf(velocity.velocity);
      const share = speedShare(speedMps, { loMps, hiMps });
      const opacity = on ? speedDustOpacity(share, altitudeM, { farShare }) : 0;
      const rate = driftRate(share, { driftMin, driftMax });
      const dtS = lastMs === null ? 0 : Math.max(0, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      offset = advanceField(offset, dir, rate, dtS);
      report = {
        ...knobs,
        speedMps,
        share,
        opacity,
        drift: rate,
        direction: dir,
        shown: opacity > 0,
      };
      if (!report.shown) return;
      // At least a frame's worth of motion: continuous at 5-10 Hz.
      const exposureS = Math.max(exposureMs, dtS * 1000) / 1000;
      const s = streaks(seeds, offset, dir, rate, exposureS, opacity);
      heads.array.set(s.heads);
      tails.array.set(s.tails);
      alphas.array.set(s.alpha);
      heads.addUpdateRange(0, count * 3);
      tails.addUpdateRange(0, count * 3);
      alphas.addUpdateRange(0, count);
      heads.needsUpdate = true;
      tails.needsUpdate = true;
      alphas.needsUpdate = true;
      dustCamera.quaternion.copy(quaternion);
      dustCamera.fov = fovDeg;
      dustCamera.aspect = aspect;
      dustCamera.updateProjectionMatrix();
      dustCamera.updateMatrixWorld();
      renderer.getDrawingBufferSize(size);
      uniforms.uViewport.value.copy(size);
      uniforms.uWidthPx.value = widthPx * renderer.getPixelRatio();
    },
    render(renderer, weight) {
      if (!report.shown || !(weight > 0)) return;
      uniforms.uWeight.value = weight;
      renderer.render(dustScene, dustCamera);
    },
    state: () => report,
    sample(n = 200) {
      const out: {
        head: [number, number];
        tail: [number, number];
        alpha: number;
      }[] = [];
      const p = new THREE.Vector3();
      const toScreen = (x: number, y: number, z: number) => {
        p.set(x, y, z).project(dustCamera);
        return [(p.x + 1) / 2, (1 - p.y) / 2, p.z] as const;
      };
      const at = (a: THREE.InstancedBufferAttribute, i: number) =>
        a.array[i] ?? 0;
      const point = (a: THREE.InstancedBufferAttribute, i: number) =>
        toScreen(at(a, 3 * i), at(a, 3 * i + 1), at(a, 3 * i + 2));
      // A streak counts when it is lit, in depth at both ends, and its head
      // is on screen.
      const projected = (i: number) => {
        const alpha = at(alphas, i);
        if (!(alpha > 0.05)) return null;
        const h = point(heads, i);
        const t = point(tails, i);
        const off =
          outside(h[2], -1, 1) ||
          outside(t[2], -1, 1) ||
          outside(h[0], 0, 1) ||
          outside(h[1], 0, 1);
        return off
          ? null
          : {
              head: [h[0], h[1]] as [number, number],
              tail: [t[0], t[1]] as [number, number],
              alpha,
            };
      };
      for (let i = 0; i < count && out.length < n; i++) {
        const streak = projected(i);
        if (streak) out.push(streak);
      }
      const d = report.direction;
      const ahead = toScreen(d[0], d[1], d[2]);
      const focus: [number, number] | null =
        ahead[2] > -1 && ahead[2] < 1 ? [ahead[0], ahead[1]] : null;
      return { streaks: out, focus };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
