/**
 * The cloud SHEET (plan 2026-09-24-1010-lookdev-fly-through-cloud-layer-plan,
 * DEC-SUN-16): the dome layer's clouds on a real horizontal plane ~2 km up,
 * so a camera can fly up to them, through them, and look down on them.
 *
 * The sheet carries the dome layer's pattern, cover and light (the same GLSL
 * chunk, `atmosphere-glsl.ts`), and fades NEAR the camera (flying through is
 * a dissolve, with no line where the camera crosses) and with HORIZONTAL
 * distance (so its finite edge never shows). It follows the camera in x/z,
 * sampling the noise in world coordinates, so the pattern does not swim.
 *
 * WHAT LIVES HERE: the constants, the fade's CPU twin (`cloudSheetFade`),
 * the draw-order rule, and the mesh. `SkyAtmosphere` owns the mesh and adds
 * it only in `cloudMode: 'sheet'`.
 *
 * @see cloud-sheet.ts.md
 */

import * as THREE from 'three';

import { smoothstep } from '../../utils/smoothstep.js';
import { CLOUD_LAYER } from './cloud-layer.js';
import { glslFloat } from '../../utils/glsl-float.js';
import {
  ATMOSPHERE_CLOUD_GLSL,
  ATMOSPHERE_COMMON_GLSL,
  ATMOSPHERE_MAX_SCENE_RADIANCE,
} from './atmosphere-glsl.js';

/**
 * The sheet's geometry and fades, metres (the scene's unit). The GLSL
 * receives every one of them from here.
 */
export const CLOUD_SHEET = {
  /** Height above the ground plane y = 0 (the dome layer's 2 km). */
  altitudeM: 2000,
  /** Half the square's edge; bounded by the far fade, not by the tile. */
  radiusM: 24_000,
  /** Near the camera: transparent up to the start, opaque from the end. */
  nearFadeStartM: 60,
  nearFadeEndM: 400,
  /** Horizontal distance: opaque up to the start, gone from the end (< R). */
  farFadeStartM: 14_000,
  farFadeEndM: 21_000,
  /**
   * The mesh: a disc of rings, geometrically spaced from `innerRadiusM` out
   * to `radiusM` (each `ringRatio` times the last), in `sectors` slices,
   * so triangles grow with their distance from the camera the sheet follows.
   * A uniform grid of 1.5 km triangles broke with the camera 0.5 m above the
   * sheet: every fragment of the triangle under the eye got the SAME world
   * position (measured with a debug output in the look-dev page, SwiftShader;
   * the cause was not established), so the near fade saw one distance and
   * the sheet drew solid white. Small triangles near the eye avoid it.
   */
  innerRadiusM: 2,
  ringRatio: 1.25,
  sectors: 48,
  /**
   * The cloud TOPS' albedo, seen from above: sunlit cloud tops are close to
   * white (a thick deck reflects ~0.6-0.9). The dome's model lights only
   * undersides seen from below, which left the deck a dull grey from above.
   */
  topAlbedo: 0.8,
} as const;

/**
 * The radiance of a cloud TOP seen from above, for a sun of illuminance 1
 * (the unit of `cloudLitRadiance`): a diffuse reflector of `topAlbedo`
 * under the sun's transmitted light at its height, plus the zenith sky as
 * ambient. GLSL twin: `atmCloudTopLit` in `CLOUD_SHEET_FRAGMENT_GLSL`.
 * The same form as the sky's ground term (radiance = E·cosθ·albedo/π).
 */
export function cloudTopRadiance(
  sunTransmittance: readonly [number, number, number],
  sunY: number,
  zenith: readonly [number, number, number]
): [number, number, number] {
  const sun = (Math.max(sunY, 0) * CLOUD_SHEET.topAlbedo) / Math.PI;
  const ambient = CLOUD_LAYER.skyAmbient;
  return [
    sunTransmittance[0] * sun + zenith[0] * ambient,
    sunTransmittance[1] * sun + zenith[1] * ambient,
    sunTransmittance[2] * sun + zenith[2] * ambient,
  ];
}

/**
 * `atmCloudTopLit`, the sunlit cloud TOP (twin of `cloudTopRadiance`),
 * shared by the sheet and the slab (`cloud-slab.ts`), so both draw one top.
 * Expects `ATMOSPHERE_CLOUD_GLSL` and the sky's LUT uniforms before it.
 */
export const CLOUD_TOP_LIT_GLSL = /* glsl */ `
const float ATM_SHEET_TOP_ALBEDO = ${glslFloat(CLOUD_SHEET.topAlbedo)};

// Twin of cloud-sheet.ts cloudTopRadiance: a top seen from above reflects
// the sun diffusely (the sky's ground-term form), plus the sky as ambient.
vec3 atmCloudTopLit(float r) {
  vec3 sunAtCloud = atmSampleTransmittance(atmTransmittanceLut, r + ATM_CLOUD_ALTITUDE, atmSunDirection.y);
  vec3 zenith = texture2D(atmSkyViewLut, atmSkyViewUv(r, vec3(0.0, 1.0, 0.0), atmSunDirection)).rgb;
  return ATM_RADIANCE_SCALE * sunAtCloud * max(atmSunDirection.y, 0.0) * ATM_SHEET_TOP_ALBEDO / ATM_PI
    + zenith * ATM_CLOUD_SKY_AMBIENT;
}
`;

/** The sheet's vertex: world position out, for the fades and the noise. */
const CLOUD_SHEET_VERTEX_GLSL = /* glsl */ `
varying vec3 vAtmSheetWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vAtmSheetWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * The sheet's fragment: the dome layer's noise sampled at the fragment's
 * WORLD x/z (metres → km → tiles), the same density and light, faded near
 * the camera and with horizontal distance (`cloudSheetFade`'s twin), and the
 * dome's aerial fade as alpha. Output like the sky: scene units, clamped,
 * then three's tone mapping and output colour space, so the sheet blends in
 * display space on the canvas (plan §2: soft edges differ slightly from the
 * dome's linear mix).
 */
export const CLOUD_SHEET_FRAGMENT_GLSL = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
uniform sampler2D atmTransmittanceLut;
uniform sampler2D atmSkyViewLut;
uniform vec3 atmSunDirection;
uniform float atmObserverRadius;
uniform float atmRadianceToScene;
const float ATM_MAX_SCENE_RADIANCE = ${glslFloat(ATMOSPHERE_MAX_SCENE_RADIANCE)};
${ATMOSPHERE_CLOUD_GLSL}
const float ATM_SHEET_NEAR_START = ${glslFloat(CLOUD_SHEET.nearFadeStartM)};
const float ATM_SHEET_NEAR_END = ${glslFloat(CLOUD_SHEET.nearFadeEndM)};
const float ATM_SHEET_FAR_START = ${glslFloat(CLOUD_SHEET.farFadeStartM)};
const float ATM_SHEET_FAR_END = ${glslFloat(CLOUD_SHEET.farFadeEndM)};
${CLOUD_TOP_LIT_GLSL}
varying vec3 vAtmSheetWorld;

void main() {
  vec3 toFragment = vAtmSheetWorld - cameraPosition;
  float distanceM = length(toFragment);
  // Twin of cloudSheetFade.
  float fade = smoothstep(ATM_SHEET_NEAR_START, ATM_SHEET_NEAR_END, distanceM)
    * (1.0 - smoothstep(ATM_SHEET_FAR_START, ATM_SHEET_FAR_END, length(toFragment.xz)));
  if (atmCloudCover <= 0.0 || fade <= 0.0) discard;
  vec2 uv = vAtmSheetWorld.xz * 0.001 / ATM_CLOUD_TILE + atmCloudOffset;
  float density = atmCloudDensity(atmCloudNoise(uv), atmCloudThreshold);
  float alpha = density * fade * exp(-distanceM * 0.001 / ATM_CLOUD_AERIAL_KM);
  if (alpha <= 0.0) discard;
  vec3 dir = toFragment / distanceM;
  // From below, the dome's light (the underside, forward scattering); from
  // above, the sunlit top. The switch is at edge-on, where the near fade
  // and the grazing angle have the sheet invisible.
  vec3 lit = dir.y < 0.0
    ? atmCloudTopLit(atmObserverRadius)
    : atmCloudLit(dir, atmObserverRadius, density);
  gl_FragColor = vec4(min(lit * atmRadianceToScene, vec3(ATM_MAX_SCENE_RADIANCE)), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * How the clouds are drawn: on the sky dome, on the fly-through sheet, or
 * in the ray-marched slab (`cloud-slab.ts`).
 */
export const CLOUD_MODES = ['dome', 'sheet', 'slab'] as const;
export type CloudMode = (typeof CLOUD_MODES)[number];

/**
 * The sheet's opacity factor from the camera: 0 within `nearFadeStartM`
 * (3D distance), 0 beyond `farFadeEndM` (horizontal distance), a smoothstep
 * between. GLSL twin: the `fade` of `CLOUD_SHEET_FRAGMENT_GLSL`.
 *
 * @throws RangeError for a distance that is negative or not finite, or a
 *   horizontal distance larger than the distance.
 */
export function cloudSheetFade(distanceM: number, horizontalM: number): number {
  if (
    !(Number.isFinite(distanceM) && Number.isFinite(horizontalM)) ||
    distanceM < 0 ||
    horizontalM < 0 ||
    horizontalM > distanceM * (1 + 1e-12)
  ) {
    throw new RangeError(
      `sheet distances must be finite, non-negative and horizontal ≤ total, got ${distanceM}, ${horizontalM}`
    );
  }
  const s = CLOUD_SHEET;
  return (
    smoothstep(s.nearFadeStartM, s.nearFadeEndM, distanceM) *
    (1 - smoothstep(s.farFadeStartM, s.farFadeEndM, horizontalM))
  );
}

/**
 * The sheet's `renderOrder` for a camera at height `cameraY`: behind every
 * other transparent object (-1) while the camera is below it, in front (+1)
 * while above. three sorts transparent objects by renderOrder first, and
 * sprites write depth, so the wrong order cuts holes in the clouds.
 */
export function cloudSheetRenderOrder(cameraY: number): number {
  return cameraY > CLOUD_SHEET.altitudeM ? 1 : -1;
}

/** The ring radii of the sheet's disc: 0, then `innerRadiusM` × ratio^k, then R. */
export function cloudSheetRingRadii(): number[] {
  const { innerRadiusM, ringRatio, radiusM } = CLOUD_SHEET;
  const radii = [0];
  for (let r = innerRadiusM; r < radiusM; r *= ringRatio) radii.push(r);
  radii.push(radiusM);
  return radii;
}

/**
 * The sheet's disc in the y = 0 plane (the mesh sits at the altitude),
 * facing up: a centre fan, then quads between consecutive rings.
 */
function cloudSheetGeometry(): THREE.BufferGeometry {
  const radii = cloudSheetRingRadii();
  const n = CLOUD_SHEET.sectors;
  const positions = [0, 0, 0];
  for (let k = 1; k < radii.length; k++) {
    for (let j = 0; j < n; j++) {
      const a = (2 * Math.PI * j) / n;
      positions.push(radii[k]! * Math.cos(a), 0, radii[k]! * Math.sin(a));
    }
  }
  const ring = (k: number, j: number) => 1 + (k - 1) * n + (j % n);
  const indices: number[] = [];
  for (let j = 0; j < n; j++) indices.push(0, ring(1, j + 1), ring(1, j));
  for (let k = 1; k < radii.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const a = ring(k, j);
      const b = ring(k, j + 1);
      const c = ring(k + 1, j);
      const d = ring(k + 1, j + 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  return geometry;
}

/**
 * The sheet mesh, reading the given uniforms (the sky's LUTs, sun, scale and
 * the cloud uniforms, spread so one update reaches the sky and the sheet).
 * Re-centred on the rendering camera in `onBeforeRender`, which three calls
 * before it computes the model-view matrix, so the move lands this frame.
 */
export function createCloudSheet(
  uniforms: Record<string, THREE.IUniform>
): THREE.Mesh {
  const geometry = cloudSheetGeometry();
  const material = new THREE.ShaderMaterial({
    name: 'atmosphere-cloud-sheet',
    vertexShader: CLOUD_SHEET_VERTEX_GLSL,
    fragmentShader: CLOUD_SHEET_FRAGMENT_GLSL,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const sheet = new THREE.Mesh(geometry, material);
  sheet.name = 'atmosphere-cloud-sheet';
  // It follows the camera, so its bounds never describe what is visible.
  sheet.frustumCulled = false;
  sheet.position.y = CLOUD_SHEET.altitudeM;
  sheet.renderOrder = -1;
  const cameraAt = new THREE.Vector3();
  sheet.onBeforeRender = (_renderer, _scene, camera) => {
    cameraAt.setFromMatrixPosition(camera.matrixWorld);
    sheet.position.set(cameraAt.x, CLOUD_SHEET.altitudeM, cameraAt.z);
    sheet.updateMatrixWorld();
    // Takes effect from the next frame (the sort already ran). A crossing
    // hides the lag (the near fade); a JUMP across the sheet (a view change)
    // draws one frame in the old order, where a sprite can show through.
    sheet.renderOrder = cloudSheetRenderOrder(cameraAt.y);
  };
  return sheet;
}
