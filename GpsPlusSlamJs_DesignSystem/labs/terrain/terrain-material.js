/**
 * The terrain lab's mesh and style-A shader (terrain plan 2026-09-27-0605 §4
 * "Mesh" and "Shading"; research 2026-09-27-0600 §6.1, §7.1).
 *
 * - ONE grid over the drawn region (not the padding), a vertex every
 *   `meshStepPosts` posts; the vertex shader lifts it by the datum-relative
 *   height times `uExag`. E enters the HEIGHT only, never the shading normal
 *   (plan §9 finding 20), so exaggeration lifts the land without darkening it.
 * - The fragment shader shades per pixel from the precomputed textures, which
 *   are finer than the mesh: that is where the fine ridge texture comes from.
 *   It mirrors `terrain-style.js` line for line (the tested reference).
 * - Half floats only (plan §9 finding 13): RGBA16F data, RGBA8 aux and LUT,
 *   all filterable in core WebGL2, so there is no extension risk.
 * - Colours are sRGB throughout and written as they are: no tone mapping and
 *   no colour-space conversion, as a printed map. The smoke holds a rendered
 *   flat pixel to `landColour` because of this.
 *
 * @see terrain-material.js.md
 */
import * as THREE from "three";

import { AUX_ENCODING } from "./terrain-precompute.js";
import {
  LIGHT_AZIMUTHS_DEG,
  LUT,
  NO_DATA_COLOURS,
  hexToRgb,
} from "./terrain-style.js";

const DEG = Math.PI / 180;

const vertexShader = /* glsl */ `
uniform sampler2D uData;
uniform float uSide;
uniform float uExtentM;
uniform float uExag;
varying vec2 vUv;

void main() {
  // three's frame: x east, z south; the grid's rows run south to north.
  vec2 enu = vec2(position.x, -position.z);
  vec2 g = clamp((enu + uExtentM) / (2.0 * uExtentM), 0.0, 1.0) * (uSide - 1.0);
  vUv = (g + 0.5) / uSide;
  float h = texture2D(uData, vUv).r;
  vec3 lifted = vec3(position.x, h * uExag, position.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(lifted, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uData;
uniform sampler2D uAux;
uniform sampler2D uLut;
uniform float uDatum;
uniform float uLutMaxM;
uniform float uStdSpanM;
uniform float uSmallMPerStep;
uniform float uGain;
uniform vec3 uLightDir[4];
uniform float uLightAz[4];
uniform vec3 uGreen;
uniform vec2 uGreenR;
uniform float uGreenAmount;
uniform float uShadow;
uniform vec3 uShadowTint;
uniform float uHighlight;
uniform vec3 uHighlightTint;
uniform float uAo;
uniform float uDetail;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform float uWaterDeepM;
uniform vec3 uNoData[2];
varying vec2 vUv;

// terrain-style.js multidirectionalShade: flat ground is exactly 1.
float shade(vec2 grad) {
  if (grad.x == 0.0 && grad.y == 0.0) return 1.0;
  vec3 n = normalize(vec3(-grad * uGain, 1.0));
  float aspect = atan(-grad.x, -grad.y);
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    float w = sin(aspect - uLightAz[i]);
    s += w * w * dot(n, uLightDir[i]) / uLightDir[i].z;
  }
  return 0.5 * s;
}

void main() {
  vec4 d = texture2D(uData, vUv);
  vec4 a = texture2D(uAux, vUv);
  if (a.a < 0.5) {
    // No data: a hatch, never a colour a height could have.
    float stripe = mod(floor((gl_FragCoord.x + gl_FragCoord.y) / 6.0), 2.0);
    gl_FragColor = vec4(stripe < 0.5 ? uNoData[0] : uNoData[1], 1.0);
    return;
  }
  float h = d.r + uDatum;
  vec3 col;
  if (h <= 0.0) {
    col = mix(uWaterShallow, uWaterDeep, clamp(-h / uWaterDeepM, 0.0, 1.0));
  } else {
    // terrain-style.js landColour: the ramp, mixed toward the green by the
    // relief spread.
    vec3 ramp = texture2D(uLut, vec2(h / uLutMaxM, 0.5)).rgb;
    float spread = a.r * uStdSpanM;
    col = mix(ramp, uGreen, uGreenAmount * smoothstep(uGreenR.x, uGreenR.y, spread));
  }
  float small = (a.g * 255.0 - 128.0) * uSmallMPerStep;
  float s = shade(d.gb) + uDetail * small / 50.0;
  col *= mix(vec3(1.0), uShadowTint, uShadow * clamp(1.0 - s, 0.0, 1.0));
  col = mix(col, uHighlightTint, uHighlight * clamp(s - 1.0, 0.0, 1.0));
  col *= mix(1.0, a.b, uAo);
  gl_FragColor = vec4(col, 1.0);
}
`;

const rgb = (hex) => new THREE.Vector3(...hexToRgb(hex));

/** The four lights as ENU unit vectors (east, north, up) and azimuths. */
function lights(altitudeDeg) {
  const alt = altitudeDeg * DEG;
  return {
    dirs: LIGHT_AZIMUTHS_DEG.map(
      (az) =>
        new THREE.Vector3(
          Math.sin(az * DEG) * Math.cos(alt),
          Math.cos(az * DEG) * Math.cos(alt),
          Math.sin(alt),
        ),
    ),
    azimuths: LIGHT_AZIMUTHS_DEG.map((az) => az * DEG),
  };
}

/** A texture the shaders read, linear, clamped, no mipmaps. */
function dataTexture(array, width, height, type) {
  const texture = new THREE.DataTexture(
    array,
    width,
    height,
    THREE.RGBAFormat,
    type,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The textures: the RGBA16F data (half-float bits), the RGBA8 aux and the
 * ramp's LUT. Every one is half-float or byte; `textureTypes` lists them so
 * the smoke can assert no FloatType texture exists.
 */
export function createTerrainTextures({ rgba16, rgba8, side, lut }) {
  return {
    data: dataTexture(rgba16, side, side, THREE.HalfFloatType),
    aux: dataTexture(rgba8, side, side, THREE.UnsignedByteType),
    lut: dataTexture(lut, LUT.size, 1, THREE.UnsignedByteType),
  };
}

/** The style-A material; `uniforms` are updated in place by the page. */
export function createTerrainMaterial(
  style,
  textures,
  { side, extentM, datum },
) {
  const { dirs, azimuths } = lights(style.lightAltitudeDeg);
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      uData: { value: textures.data },
      uAux: { value: textures.aux },
      uLut: { value: textures.lut },
      uSide: { value: side },
      uExtentM: { value: extentM },
      uExag: { value: 1 },
      uDatum: { value: datum },
      uLutMaxM: { value: LUT.maxM },
      uStdSpanM: { value: AUX_ENCODING.reliefStdSpanM },
      uSmallMPerStep: { value: AUX_ENCODING.reliefSmallMPerStep },
      uGain: { value: 1 },
      uLightDir: { value: dirs },
      uLightAz: { value: azimuths },
      uGreen: { value: rgb(style.green) },
      uGreenR: { value: new THREE.Vector2(style.greenR0, style.greenR1) },
      uGreenAmount: { value: style.greenAmount },
      uShadow: { value: style.shadow },
      uShadowTint: { value: rgb(style.shadowTint) },
      uHighlight: { value: style.highlight },
      uHighlightTint: { value: rgb(style.highlightTint) },
      uAo: { value: style.ao },
      uDetail: { value: style.detail },
      uWaterShallow: { value: rgb(style.waterShallow) },
      uWaterDeep: { value: rgb(style.waterDeep) },
      uWaterDeepM: { value: style.waterDeepM },
      uNoData: { value: NO_DATA_COLOURS.map(rgb) },
    },
  });
}

/**
 * The grid over the drawn region, ±`halfExtentM`, a vertex every `stepM`
 * metres; flat (y = 0), the vertex shader lifts it.
 */
export function createTerrainGeometry(halfExtentM, stepM) {
  const n = Math.round((2 * halfExtentM) / stepM) + 1;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      positions[k] = -halfExtentM + (i / (n - 1)) * 2 * halfExtentM;
      // Row j runs south to north; three's z is south.
      positions[k + 2] = halfExtentM - (j / (n - 1)) * 2 * halfExtentM;
    }
  }
  const index = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}
