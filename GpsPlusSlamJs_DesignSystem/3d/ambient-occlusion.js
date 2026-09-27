/**
 * Screen-space ambient occlusion for the look-dev page's DESKTOP tier
 * (round-3 plan 2026-09-27-0532 stream C; round-2 plan 2026-09-26-2055
 * M2e): three's own `GTAOPass`, with the page's three changes.
 *
 * - The sky, the clouds and everything else that is transparent or writes
 *   no depth stays out of the AO's normal/depth pass. three hides only
 *   points and lines there, and draws every other mesh with one override
 *   material, so the sky's 2 m box and the cloud meshes would be drawn as
 *   opaque geometry the main pass never has.
 * - The AO is multiplied IN PLACE onto the composer's scene target instead
 *   of copied into the other buffer, so the pass does not swap. The
 *   composer's scene is drawn into its multisampled target only while an
 *   even number of passes swap (lookdev.js `applyTier`).
 * - The AO fades out with view depth before the hazed distance.
 *
 * No imports: the page hands in `GTAOPass`, so Node's runner tests this
 * against the real pass of the three the page serves.
 *
 * @see ambient-occlusion.js.md
 */

/**
 * The AO at the scene's metre scale (view-space metres, not pixels).
 * Chosen by the sweep in the record doc 2026-09-27 lookdev-gtao-results.
 */
export const AO_PARAMS = Object.freeze({
  radius: 5,
  distanceExponent: 1,
  thickness: 8,
  distanceFallOff: 1,
  scale: 1,
  samples: 16,
  screenSpaceRadius: false,
  // The page's own: the AO fades out between these view depths (metres),
  // before the hazed distance (see the blend below).
  fadeStartM: 300,
  fadeEndM: 700,
});

/**
 * The blend: three's (multiply the scene by the denoised AO, at
 * `intensity`), faded out with view depth, read from the pass's own depth
 * target. Metre-scale AO is below a few pixels in the hazed distance, and
 * there it was measured darkening whole facades and the ground-ridge line
 * at 2.5 km (record doc), where the haze, not occlusion, sets the colour.
 */
const FADE_BLEND_FRAGMENT = /* glsl */ `
uniform float intensity;
uniform sampler2D tDiffuse;
uniform highp sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform float fadeStart;
uniform float fadeEnd;
varying vec2 vUv;
#include <packing>
void main() {
  vec4 texel = texture2D( tDiffuse, vUv );
  float depth = texture2D( tDepth, vUv ).x;
  float viewDepth = -perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
  float keep = 1.0 - smoothstep( fadeStart, fadeEnd, viewDepth );
  gl_FragColor = vec4( mix( vec3( 1.0 ), texel.rgb, intensity * keep ), texel.a );
}`;

/** The denoise, in pixels of the AO target. */
export const AO_DENOISE = Object.freeze({
  radius: 8,
  lumaPhi: 10,
  depthPhi: 2,
  normalPhi: 3,
  samples: 16,
  rings: 2,
  radiusExponent: 2,
});

const materialsOf = (object) =>
  Array.isArray(object.material) ? object.material : [object.material];

/**
 * Whether `object` is left out of the AO's normal/depth pass: sprites,
 * lines and points, and a mesh none of whose materials is an opaque,
 * depth-writing, visible one. Such a mesh is not in the main pass's depth
 * either, so the AO must not see it. Groups and other non-drawables: never.
 */
export function hiddenFromAoNormals(object) {
  if (object.isSprite || object.isPoints || object.isLine || object.isLine2) {
    return true;
  }
  if (!object.isMesh) return false;
  return !materialsOf(object).some(
    (m) => m && m.visible !== false && !m.transparent && m.depthWrite,
  );
}

/**
 * `GTAOPass` with the page's exclusions, the depth fade and the in-place
 * blend. It relies on three's INTERNALS (`_overrideVisibility` and
 * `_visibilityCache`, `_renderPass`, the blend material's uniforms);
 * ambient-occlusion.test.mjs fails if a three upgrade takes them away.
 */
export function withPageExclusions(GTAOPass) {
  return class PageGTAOPass extends GTAOPass {
    constructor(...args) {
      super(...args);
      this.needsSwap = false;
      /**
       * Test surface: false falls back to three's own rule (points and
       * lines only), so a smoke test can show in the same run what the
       * exclusions prevent.
       */
      this.pageExclusions = true;
      this.resolutionScale = 1;
      this._fadeBlend();
    }

    /**
     * Turn three's blend into the depth-faded one, once. Called from the
     * constructor AND from `updateGtaoMaterial`, which three's constructor
     * calls before this class's constructor body runs.
     */
    _fadeBlend() {
      const material = this.blendMaterial;
      if (material.uniforms.fadeStart) return material.uniforms;
      material.fragmentShader = FADE_BLEND_FRAGMENT;
      Object.assign(material.uniforms, {
        tDepth: { value: this.depthTexture },
        cameraNear: { value: this.camera.near },
        cameraFar: { value: this.camera.far },
        fadeStart: { value: AO_PARAMS.fadeStartM },
        fadeEnd: { value: AO_PARAMS.fadeEndM },
      });
      material.needsUpdate = true;
      return material.uniforms;
    }

    updateGtaoMaterial(parameters) {
      super.updateGtaoMaterial(parameters);
      const u = this._fadeBlend();
      if (parameters.fadeStartM !== undefined) {
        u.fadeStart.value = parameters.fadeStartM;
      }
      if (parameters.fadeEndM !== undefined) {
        u.fadeEnd.value = parameters.fadeEndM;
      }
    }

    /** The composer's size, scaled by `resolutionScale` (1 = full size). */
    setSize(width, height) {
      this.unscaledSize = [width, height];
      const s = this.resolutionScale;
      super.setSize(
        Math.max(1, Math.round(width * s)),
        Math.max(1, Math.round(height * s)),
      );
    }

    _overrideVisibility() {
      if (!this.pageExclusions) {
        super._overrideVisibility();
        return;
      }
      const cache = this._visibilityCache;
      this.scene.traverse((object) => {
        if (object.visible && hiddenFromAoNormals(object)) {
          object.visible = false;
          cache.push(object);
        }
      });
    }

    render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      // three's own steps up to the denoised AO, and no output of its own.
      const output = this.output;
      this.output = GTAOPass.OUTPUT.Off;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      this.output = output;
      const u = this.blendMaterial.uniforms;
      u.intensity.value = this.blendIntensity;
      u.tDiffuse.value = this.pdRenderTarget.texture;
      u.cameraNear.value = this.camera.near;
      u.cameraFar.value = this.camera.far;
      this._renderPass(
        renderer,
        this.blendMaterial,
        this.renderToScreen ? null : readBuffer,
      );
    }
  };
}

/**
 * The page's AO: one pass, created the first time it is switched on while a
 * composer exists, inserted right after the composer's RenderPass (before
 * the HDR clamp and the bloom).
 *
 * `sync(composer, on)` brings it to the state. A different composer (or
 * none, the phone tier) drops the pass: the page disposes a composer's
 * passes with it.
 */
export function createAmbientOcclusion({
  GTAOPass,
  scene,
  camera,
  params = AO_PARAMS,
  denoise = AO_DENOISE,
}) {
  const PagePass = withPageExclusions(GTAOPass);
  let pass = null;
  let host = null;
  let current = { ...params };
  let currentDenoise = { ...denoise };
  let scale = 1;
  return {
    sync(composer, on) {
      if (composer !== host) {
        pass = null;
        host = composer ?? null;
      }
      if (!composer) return;
      if (on && !pass) {
        pass = new PagePass(
          scene,
          camera,
          1,
          1,
          undefined,
          current,
          currentDenoise,
        );
        pass.resolutionScale = scale;
        const after = composer.passes.findIndex((p) => p.isRenderPass);
        composer.insertPass(pass, after + 1);
      }
      if (pass) pass.enabled = Boolean(on);
    },
    /**
     * The sweep's handle: merge AO and denoise parameters (and the AO
     * targets' `resolutionScale`, 1 = the composer's size) into the live
     * pass and into any pass built later. Returns the merged values.
     */
    configure({ params: p = {}, denoise: d = {}, resolutionScale } = {}) {
      current = { ...current, ...p };
      currentDenoise = { ...currentDenoise, ...d };
      pass?.updateGtaoMaterial(p);
      pass?.updatePdMaterial(d);
      if (resolutionScale !== undefined) {
        if (!(resolutionScale > 0 && resolutionScale <= 1)) {
          throw new RangeError(`resolutionScale must be in (0, 1]`);
        }
        scale = resolutionScale;
        if (pass) {
          pass.resolutionScale = scale;
          if (pass.unscaledSize) pass.setSize(...pass.unscaledSize);
        }
      }
      return {
        params: { ...current },
        denoise: { ...currentDenoise },
        resolutionScale: scale,
      };
    },
    /** The pass, or null (never switched on under this composer). */
    get pass() {
      return pass;
    },
    /** Whether the AO draws. */
    get active() {
      return pass?.enabled ?? false;
    },
  };
}
