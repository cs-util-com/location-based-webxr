/**
 * The speed dust's pass in the globe lab (round-3 plan 2026-10-08-2345,
 * D1; the pure model is `/globe/globe-speed-dust.js`): streaks pouring past
 * the camera, drawn as instanced quads in a scene of their own with a
 * camera that has the view's ECEF orientation at the origin, so the field
 * lives in ECEF axes and a world-frame recentre never spins it. Additive,
 * no depth: drawn before the Earth (which covers it) at 1 - `over` and
 * after it at `over`.
 *
 * @see globe-speed-dust-pass.js.md
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
} from "/globe/globe-speed-dust.js";

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

/** The most streaks the pass holds (the panel's `dustCount` maximum). */
export const SPEED_DUST_MAX_COUNT = 4000;

/**
 * A knob's range, or the default when it is not a positive, rising pair
 * (a pasted link with crossed ranges falls back instead of throwing on
 * every frame: the F1b/D1b milestone review).
 */
function rangeOr(lo, hi, fallbackLo, fallbackHi) {
  return lo > 0 && hi > lo && Number.isFinite(hi)
    ? [lo, hi]
    : [fallbackLo, fallbackHi];
}

/** The streaks' tints (`dustColor`, D1b): bluish white, white, warm. */
export const SPEED_DUST_COLORS = Object.freeze([
  [0.85, 0.9, 1.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.85, 0.65],
]);

/**
 * The pass: `update(...)` each frame with the camera's ECEF pose, then
 * `render(renderer, weight)`; `reset()` where the lab teleports the camera;
 * `state()` for the smokes; `sample(n)` the first n visible streaks
 * projected (normalised screen points, 0 at the top-left). The field holds
 * `maxCount` seeds; `update`'s `count` draws a prefix of them (a prefix of
 * a uniform field is uniform), so the count is a live knob (D1b).
 */
export function createSpeedDustPass(maxCount = SPEED_DUST_MAX_COUNT) {
  const all = createSpeedField(maxCount);
  let count = GLOBE_SPEED_DUST.count;
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
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uWidthPx: { value: 1.5 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uWeight: { value: 1 },
      uGain: { value: 1 },
      uColor: { value: new THREE.Vector3(...SPEED_DUST_COLORS[0]) },
    },
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
  let offset = [0, 0, 0];
  let lastMs = null;
  let report = {
    count,
    speedMps: 0,
    share: 0,
    opacity: 0,
    drift: 0,
    direction: [0, 0, 0],
    shown: false,
  };

  return {
    /** Forget the velocity (the camera was placed, not flown). */
    reset() {
      velocity = startVelocity();
      lastMs = null;
    },
    /**
     * This frame: the camera's ECEF `position` and `quaternion`, its
     * altitude, field of view and aspect, the time, and the look's knobs.
     */
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
      look = {},
    }) {
      // The panel's knobs (D1b), each the default when absent.
      const n = Math.round(
        Math.min(Math.max(look.count ?? GLOBE_SPEED_DUST.count, 1), maxCount),
      );
      if (n !== count) {
        count = n;
        seeds = all.subarray(0, count * 3);
        geometry.instanceCount = count;
      }
      const [loMps, hiMps] = rangeOr(
        look.loMps ?? GLOBE_SPEED_DUST.loMps,
        look.hiMps ?? GLOBE_SPEED_DUST.hiMps,
        GLOBE_SPEED_DUST.loMps,
        GLOBE_SPEED_DUST.hiMps,
      );
      const [driftMin, driftMax] = rangeOr(
        look.driftMin ?? GLOBE_SPEED_DUST.driftMin,
        look.driftMax ?? GLOBE_SPEED_DUST.driftMax,
        GLOBE_SPEED_DUST.driftMin,
        GLOBE_SPEED_DUST.driftMax,
      );
      const speedRange = { loMps, hiMps };
      const driftRange = { driftMin, driftMax };
      const gain = look.gain >= 0 ? look.gain : 1;
      const color = SPEED_DUST_COLORS[look.color] ? look.color : 0;
      material.uniforms.uGain.value = gain;
      material.uniforms.uColor.value.set(...SPEED_DUST_COLORS[color]);
      velocity = stepVelocity(
        velocity,
        [position.x, position.y, position.z],
        nowMs,
        altitudeM,
      );
      const v = velocity.velocity;
      const speedMps = Math.hypot(v[0], v[1], v[2]);
      const share = speedShare(speedMps, speedRange);
      const opacity = on ? speedDustOpacity(share, altitudeM) : 0;
      const rate = driftRate(share, driftRange);
      const dir =
        speedMps > 0
          ? [v[0] / speedMps, v[1] / speedMps, v[2] / speedMps]
          : [0, 0, 0];
      const dtS = lastMs === null ? 0 : Math.max(0, (nowMs - lastMs) / 1000);
      lastMs = nowMs;
      offset = advanceField(offset, dir, rate, dtS);
      report = {
        count,
        gain,
        color,
        loMps,
        hiMps,
        driftMin,
        driftMax,
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
      material.uniforms.uViewport.value.copy(size);
      material.uniforms.uWidthPx.value = widthPx * renderer.getPixelRatio();
    },
    /** Draws the streaks at `weight` (no-op when not shown or weight 0). */
    render(renderer, weight) {
      if (!report.shown || !(weight > 0)) return;
      material.uniforms.uWeight.value = weight;
      renderer.render(dustScene, dustCamera);
    },
    state: () => report,
    /**
     * The first `n` visible streaks, projected: heads and tails as
     * normalised screen points (0 at the top-left), and the focus of
     * expansion (where the motion points on screen, or null behind).
     */
    sample(n = 200) {
      const out = [];
      const p = new THREE.Vector3();
      const toScreen = (x, y, z) => {
        p.set(x, y, z).project(dustCamera);
        return [(p.x + 1) / 2, (1 - p.y) / 2, p.z];
      };
      for (let i = 0; i < count && out.length < n; i++) {
        if (!(alphas.array[i] > 0.05)) continue;
        const h = toScreen(
          heads.array[3 * i],
          heads.array[3 * i + 1],
          heads.array[3 * i + 2],
        );
        const t = toScreen(
          tails.array[3 * i],
          tails.array[3 * i + 1],
          tails.array[3 * i + 2],
        );
        if (h[2] < -1 || h[2] > 1 || t[2] < -1 || t[2] > 1) continue;
        if (h[0] < 0 || h[0] > 1 || h[1] < 0 || h[1] > 1) continue;
        out.push({
          head: [h[0], h[1]],
          tail: [t[0], t[1]],
          alpha: alphas.array[i],
        });
      }
      const d = report.direction;
      const ahead = toScreen(d[0], d[1], d[2]);
      const focus = ahead[2] > -1 && ahead[2] < 1 ? [ahead[0], ahead[1]] : null;
      return { streaks: out, focus };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
