/**
 * God rays for the look-dev page (round-3 look-dev programme, stream G):
 * radial screen-space light shafts. The bright SKY around the sun (pixels
 * at the cleared depth, so buildings, terrain and the floating parts
 * block it, and clouds block it through the darker sky they draw) is
 * blurred along lines toward the sun's screen point and added back to the
 * HDR scene, before tone mapping, like the bloom.
 *
 * Three draws per frame, the first two at a fraction of the composer's
 * size: the sky mask, the radial blur, and an additive composite into the
 * composer's read buffer. The pass does not swap, so the composer's scene
 * stays on its multisampled target (lookdev.js `applyTier`).
 *
 * No imports: the page hands in three and its `Pass` and `FullScreenQuad`,
 * so Node's runner tests the pass against the real three the page serves.
 *
 * @see god-rays.js.md
 */

/**
 * The shipped look (see the results record, 2026-09-28 lookdev god rays,
 * for the sweeps behind each value).
 *
 * - `samples`: taps along each ray (the grain; the brightness is
 *   normalised, see `rayWeights`).
 * - `endWeight`: the weight of the tap at the sun's end of the march
 *   against the pixel's own (1 = a plain average along the ray).
 * - `reach`: the share of the way to the sun the march covers.
 * - `strength`: the added light's scale.
 * - `threshold`, `maxExcess`: scene-linear luminance; the sky feeds the rays
 *   with its luminance above the threshold, capped (the disc is ~10^4 × the
 *   sky and would otherwise be the only source).
 * - `radius`: the sky counts within this distance of the sun's screen
 *   point, in canvas heights, fading to 0 at it.
 * - `scale`: the mask and ray buffers' size against the composer's.
 * - `jitter`: 0..1, how far each pixel's first tap is offset along its ray
 *   by a fixed per-pixel pattern (grain instead of banding).
 * - `airM`: metres of air over which a surface's share of the added rays
 *   reaches 1 - 1/e (the sky gets all of it); 0 adds the same everywhere.
 * - `offscreenMargin`: NDC units past the screen edge over which the rays
 *   fade out as the sun leaves the view.
 * - `horizonFadeDeg`: the sun elevations over which the rays fade in.
 */
export const GOD_RAYS = Object.freeze({
  samples: 64,
  endWeight: 0.1,
  reach: 1,
  strength: 0.25,
  threshold: 2,
  maxExcess: 16,
  radius: 0.35,
  scale: 0.25,
  jitter: 0,
  airM: 150,
  offscreenMargin: 0.3,
  horizonFadeDeg: Object.freeze([-1, 1]),
});

const MAX_SAMPLES = 256;
const DEG = Math.PI / 180;

const isFiniteNumber = (x) => typeof x === "number" && Number.isFinite(x);

function checkRay(n, endWeight) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_SAMPLES) {
    throw new RangeError(
      `samples must be an integer in 1..${MAX_SAMPLES}, got ${n}`,
    );
  }
  if (!(isFiniteNumber(endWeight) && endWeight > 0 && endWeight <= 1)) {
    throw new RangeError(`endWeight must be in (0, 1], got ${endWeight}`);
  }
}

/**
 * The factor between one tap's weight and the next along a ray of `n`
 * taps whose last tap weighs `endWeight` × the first.
 */
export function stepDecay(n, endWeight) {
  checkRay(n, endWeight);
  return n === 1 ? 1 : endWeight ** (1 / (n - 1));
}

/**
 * The normalised tap weights of one ray, from the pixel toward the sun:
 * geometric, summing to 1, so the sample count changes the grain but not
 * the brightness (the shader divides by the same total).
 */
export function rayWeights(n, endWeight) {
  const k = stepDecay(n, endWeight);
  const w = [];
  let x = 1;
  for (let i = 0; i < n; i++) {
    w.push(x);
    x *= k;
  }
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / total);
}

/** Throws RangeError unless every value is in its range (see GOD_RAYS). */
export function validateGodRaysParams(p) {
  checkRay(p.samples, p.endWeight);
  const inHalfOpen = (x) => isFiniteNumber(x) && x > 0 && x <= 1;
  if (!(isFiniteNumber(p.jitter) && p.jitter >= 0 && p.jitter <= 1)) {
    throw new RangeError(`jitter must be in [0, 1], got ${p.jitter}`);
  }
  if (!inHalfOpen(p.reach)) {
    throw new RangeError(`reach must be in (0, 1], got ${p.reach}`);
  }
  if (!inHalfOpen(p.scale)) {
    throw new RangeError(`scale must be in (0, 1], got ${p.scale}`);
  }
  for (const key of ["strength", "threshold", "airM"]) {
    if (!(isFiniteNumber(p[key]) && p[key] >= 0)) {
      throw new RangeError(`${key} must be finite and >= 0, got ${p[key]}`);
    }
  }
  for (const key of ["maxExcess", "radius", "offscreenMargin"]) {
    if (!(isFiniteNumber(p[key]) && p[key] > 0)) {
      throw new RangeError(`${key} must be finite and > 0, got ${p[key]}`);
    }
  }
  const [lo, hi] = p.horizonFadeDeg ?? [];
  if (!(isFiniteNumber(lo) && isFiniteNumber(hi) && lo < hi)) {
    throw new RangeError(`horizonFadeDeg must be [lo, hi] with lo < hi`);
  }
}

/**
 * The sun's point in normalised device coordinates for a column-major 4×4
 * view-projection matrix `m` and a direction toward the sun (any length):
 * the direction is a point at infinity (w = 0), so the camera's position
 * does not move it. `inFront` is false for a sun behind the camera or
 * exactly sideways, where x and y mean nothing.
 */
export function sunClipPoint(m, dir) {
  if (!Array.isArray(m) && !ArrayBuffer.isView(m)) {
    throw new RangeError("the view-projection matrix must be 16 numbers");
  }
  if (m.length !== 16) {
    throw new RangeError("the view-projection matrix must be 16 numbers");
  }
  const [dx, dy, dz] = dir;
  const length = Math.hypot(dx, dy, dz);
  if (!(isFiniteNumber(length) && length > 0)) {
    throw new RangeError(`the sun direction must be finite and non-zero`);
  }
  const x = (m[0] * dx + m[4] * dy + m[8] * dz) / length;
  const y = (m[1] * dx + m[5] * dy + m[9] * dz) / length;
  const w = (m[3] * dx + m[7] * dy + m[11] * dz) / length;
  const inFront = w > 1e-9;
  return inFront
    ? { x: x / w, y: y / w, inFront }
    : { x: Number.NaN, y: Number.NaN, inFront };
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 1 while the sun's NDC point is on screen, falling smoothly to 0 at
 * `margin` NDC units past the nearer edge.
 */
export function offscreenFade(x, y, margin) {
  const out = Math.max(Math.abs(x) - 1, Math.abs(y) - 1, 0);
  return 1 - smoothstep(0, margin, out);
}

/**
 * 0 for a sun at or below `range[0]` degrees of elevation, 1 at or above
 * `range[1]`, smooth between; `sunY` is the unit sun direction's up part.
 */
export function horizonFade(sunY, range = GOD_RAYS.horizonFadeDeg) {
  const elevation = Math.asin(Math.min(1, Math.max(-1, sunY))) / DEG;
  return smoothstep(range[0], range[1], elevation);
}

/**
 * Where the rays come from and how strongly: the sun's NDC point and the
 * product of the on-screen and horizon fades (0 behind the camera).
 */
export function godRaysFade(viewProjection, dir, params = GOD_RAYS) {
  const p = sunClipPoint(viewProjection, dir);
  if (!p.inFront) return { ...p, fade: 0 };
  const up = dir[1] / Math.hypot(dir[0], dir[1], dir[2]);
  const fade =
    offscreenFade(p.x, p.y, params.offscreenMargin) *
    horizonFade(up, params.horizonFadeDeg);
  return { ...p, fade };
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * The sky near the sun, above the threshold. The sky is drawn at depth 1
 * without writing depth and the clouds write none either, so every pixel
 * still at the cleared depth is sky; a 24-bit depth sits within a few
 * steps of 1 only past ~29 km, inside the page's fog.
 */
const MASK_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform highp sampler2D tDepth;
uniform vec2 uSun;
uniform float uAspect;
uniform float uThreshold;
uniform float uMaxExcess;
uniform float uRadius;
varying vec2 vUv;
const float SKY_DEPTH = 1.0 - 4.0 / 16777215.0;
void main() {
  float depth = texture2D( tDepth, vUv ).x;
  vec3 c = texture2D( tScene, vUv ).rgb;
  float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float excess = min( lum - uThreshold, uMaxExcess );
  float r = length( ( vUv - uSun ) * vec2( uAspect, 1.0 ) );
  float near = 1.0 - smoothstep( 0.0, uRadius, r );
  float keep = depth >= SKY_DEPTH && excess > 0.0 ? excess / lum * near : 0.0;
  gl_FragColor = vec4( c * keep, 1.0 );
}`;

/**
 * The weighted mean of the mask along the line from the pixel toward the
 * sun. A fixed per-pixel offset along the ray trades banding for a fine
 * static grain; taps outside the frame count as dark.
 */
const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tMask;
uniform vec2 uSun;
uniform float uReach;
uniform float uDecay;
uniform float uJitter;
varying vec2 vUv;
void main() {
  vec2 stepUv = ( uSun - vUv ) * ( uReach / float( RAY_SAMPLES ) );
  float jitter = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  vec2 p = vUv + stepUv * ( jitter * uJitter );
  vec3 sum = vec3( 0.0 );
  float w = 1.0;
  float total = 0.0;
  for ( int i = 0; i < RAY_SAMPLES; i++ ) {
    float inside = step( 0.0, p.x ) * step( p.x, 1.0 ) * step( 0.0, p.y ) * step( p.y, 1.0 );
    sum += texture2D( tMask, p ).rgb * ( w * inside );
    total += w;
    w *= uDecay;
    p += stepUv;
  }
  gl_FragColor = vec4( sum / total, 1.0 );
}`;

/**
 * The rays added to the scene. The light a shaft scatters toward the eye
 * grows with the length of air in front of the surface, so a pixel whose
 * surface is `d` metres away gets 1 - e^(-d / L) of it (the sky all of it;
 * L = 0 switches the scaling off): a near wall is not veiled.
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tRays;
uniform highp sampler2D tDepth;
uniform float uStrength;
uniform float uAirM;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
const float SKY_DEPTH = 1.0 - 4.0 / 16777215.0;
void main() {
  float depth = texture2D( tDepth, vUv ).x;
  float air = 1.0;
  if ( uAirM > 0.0 && depth < SKY_DEPTH ) {
    float d = -perspectiveDepthToViewZ( depth, uNear, uFar );
    air = 1.0 - exp( -d / uAirM );
  }
  gl_FragColor = vec4( texture2D( tRays, vUv ).rgb * ( uStrength * air ), 0.0 );
}`;

/**
 * The pass class for the three the page hands in. `sunDirection()` returns
 * the direction toward the sun ([x, y, z], any length), read every frame.
 */
function godRaysPassClass({ THREE, Pass, FullScreenQuad }) {
  const screenMaterial = (fragmentShader, uniforms, extra = {}) =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      ...extra,
    });
  const bufferTarget = () =>
    new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

  return class GodRaysPass extends Pass {
    constructor({ camera, sunDirection, depthTexture, params }) {
      super();
      this.needsSwap = false;
      this.camera = camera;
      this.sunDirection = sunDirection;
      this.maskTarget = bufferTarget();
      this.raysTarget = bufferTarget();
      this.maskMaterial = screenMaterial(MASK_FRAGMENT, {
        tScene: { value: null },
        tDepth: { value: depthTexture },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: 1 },
        uThreshold: { value: 0 },
        uMaxExcess: { value: 1 },
        uRadius: { value: 1 },
      });
      this.blurMaterial = screenMaterial(
        BLUR_FRAGMENT,
        {
          tMask: { value: this.maskTarget.texture },
          uSun: { value: new THREE.Vector2(0.5, 0.5) },
          uReach: { value: 1 },
          uDecay: { value: 1 },
          uJitter: { value: 0 },
        },
        { defines: { RAY_SAMPLES: 1 } },
      );
      // Adds the rays' colour and keeps the target's alpha.
      this.compositeMaterial = screenMaterial(
        COMPOSITE_FRAGMENT,
        {
          tRays: { value: this.raysTarget.texture },
          tDepth: { value: depthTexture },
          uStrength: { value: 0 },
          uAirM: { value: 0 },
          uNear: { value: 1 },
          uFar: { value: 2 },
        },
        {
          blending: THREE.CustomBlending,
          blendEquation: THREE.AddEquation,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor,
        },
      );
      this.quad = new FullScreenQuad(null);
      this.viewProjection = new THREE.Matrix4();
      this.size = [1, 1];
      this.lastFade = { x: Number.NaN, y: Number.NaN, inFront: false, fade: 0 };
      this.applyParams(params);
    }

    /** Set every uniform and define from a validated parameter set. */
    applyParams(params) {
      this.params = params;
      const m = this.maskMaterial.uniforms;
      m.uThreshold.value = params.threshold;
      m.uMaxExcess.value = params.maxExcess;
      m.uRadius.value = params.radius;
      const b = this.blurMaterial;
      if (b.defines.RAY_SAMPLES !== params.samples) {
        b.defines.RAY_SAMPLES = params.samples;
        b.needsUpdate = true;
      }
      b.uniforms.uReach.value = params.reach;
      b.uniforms.uJitter.value = params.jitter;
      b.uniforms.uDecay.value = stepDecay(params.samples, params.endWeight);
      this.setSize(...this.size);
    }

    setSize(width, height) {
      this.size = [width, height];
      const s = this.params.scale;
      const w = Math.max(1, Math.round(width * s));
      const h = Math.max(1, Math.round(height * s));
      this.maskTarget.setSize(w, h);
      this.raysTarget.setSize(w, h);
      this.maskMaterial.uniforms.uAspect.value = width / Math.max(1, height);
    }

    /** The fade and sun point for the camera's current matrices. */
    updateFade() {
      this.viewProjection.multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      );
      this.lastFade = godRaysFade(
        this.viewProjection.elements,
        this.sunDirection(),
        this.params,
      );
      return this.lastFade;
    }

    render(renderer, writeBuffer, readBuffer) {
      // It adds into the composer's read buffer; as the last pass that
      // buffer never reaches the screen.
      if (this.renderToScreen) {
        throw new Error("the god-rays pass cannot be the composer's last pass");
      }
      const f = this.updateFade();
      if (!(f.fade > 0)) return;
      const sun = [(f.x + 1) / 2, (f.y + 1) / 2];
      this.maskMaterial.uniforms.uSun.value.set(...sun);
      this.blurMaterial.uniforms.uSun.value.set(...sun);
      this.maskMaterial.uniforms.tScene.value = readBuffer.texture;
      const c = this.compositeMaterial.uniforms;
      c.uStrength.value = this.params.strength * f.fade;
      c.uAirM.value = this.params.airM;
      c.uNear.value = this.camera.near;
      c.uFar.value = this.camera.far;
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      this.quad.material = this.maskMaterial;
      renderer.setRenderTarget(this.maskTarget);
      this.quad.render(renderer);
      this.quad.material = this.blurMaterial;
      renderer.setRenderTarget(this.raysTarget);
      this.quad.render(renderer);
      this.quad.material = this.compositeMaterial;
      renderer.setRenderTarget(readBuffer);
      this.quad.render(renderer);
      renderer.autoClear = oldAutoClear;
    }

    dispose() {
      this.maskTarget.dispose();
      this.raysTarget.dispose();
      this.maskMaterial.dispose();
      this.blurMaterial.dispose();
      this.compositeMaterial.dispose();
      this.quad.dispose();
    }
  };
}

/**
 * The page's god rays: one pass, created the first time they are switched
 * on while a composer exists, inserted right before the composer's
 * OutputPass (after the HDR clamp and the bloom, before tone mapping).
 * Creating it gives the composer's scene target (`renderTarget2`, where
 * the RenderPass draws while an even number of passes swap) a depth
 * texture, which the sky mask reads.
 *
 * `sync(composer, on)` brings it to the state; a different composer (or
 * none) drops the pass, and the page disposes a composer's passes with it.
 */
export function createGodRays({
  THREE,
  Pass,
  FullScreenQuad,
  camera,
  sunDirection,
  params = GOD_RAYS,
}) {
  validateGodRaysParams(params);
  const GodRaysPass = godRaysPassClass({ THREE, Pass, FullScreenQuad });
  let current = { ...params };
  let pass = null;
  let host = null;
  return {
    sync(composer, on) {
      if (composer !== host) {
        pass = null;
        host = composer ?? null;
      }
      if (!composer) return;
      if (on && !pass) {
        const target = composer.renderTarget2;
        if (!target.depthTexture) {
          // Freed first, so three sets the target up again with the texture.
          target.dispose();
          target.depthTexture = new THREE.DepthTexture(
            target.width,
            target.height,
            THREE.UnsignedIntType,
          );
        }
        pass = new GodRaysPass({
          camera,
          sunDirection,
          depthTexture: target.depthTexture,
          params: current,
        });
        const output = composer.passes.findIndex((p) => p.isOutputPass);
        composer.insertPass(pass, output < 0 ? composer.passes.length : output);
      }
      if (pass) pass.enabled = Boolean(on);
    },
    /**
     * The sweep's handle: merge values into the live pass and any pass built
     * later. Refused values (RangeError) change nothing. Returns the merged
     * set.
     */
    configure(values = {}) {
      const next = { ...current, ...values };
      validateGodRaysParams(next);
      current = next;
      pass?.applyParams(current);
      return { ...current };
    },
    /** The pass, or null (never switched on under this composer). */
    get pass() {
      return pass;
    },
    /** Whether the pass runs (it still draws nothing while the fade is 0). */
    get active() {
      return pass?.enabled ?? false;
    },
    /** The last frame's sun point and fade, and the parameters. */
    info() {
      return {
        active: pass?.enabled ?? false,
        ...(pass?.lastFade ?? { x: Number.NaN, y: Number.NaN, fade: 0 }),
        params: { ...current },
      };
    },
  };
}
