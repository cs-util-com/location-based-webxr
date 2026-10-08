/**
 * The clouds from a coverage map, and a disc around the camera (globe
 * volume-cloud plan 2026-10-05-0016, C1 and C3), shared by the cloud slab
 * and the cloud shadow so the shadow falls from exactly the clouds the slab
 * draws (DEC-H3: one implementation).
 *
 * One per-position threshold carries both: the map's local cover becomes
 * the column's noise threshold through the noise's own quantiles (the rule
 * the global cover uses), and the disc fades the threshold to clear (2)
 * from 0.7 r to r around the camera. The march, the light and the column
 * stay as they are.
 *
 * WHAT LIVES HERE: the CPU helpers (the cover table, the threshold for a
 * cover, the disc's threshold), the GLSL chunk both shaders include
 * (`CLOUD_COVERAGE_GLSL`, its parts behind `ATM_CLOUD_COVERAGE` and
 * `ATM_CLOUD_DISC`), the uniforms it declares, and the insertion of a
 * caller's coverage chunk.
 *
 * @see cloud-coverage.ts.md
 */

import * as THREE from 'three';

import { smoothstep } from '../../utils/smoothstep.js';
import { HEX_COVER_THRESHOLDS } from './cloud-hex.js';
import { cloudThreshold } from './cloud-layer.js';

/** The covers the threshold table holds: k / COVER_STEPS, k = 0 … COVER_STEPS. */
const COVER_STEPS = 32;
/** The threshold that draws no cloud: above any noise value. */
const CLEAR_THRESHOLD = 2;
let coverThresholds: readonly number[] | undefined;
let hexThresholds: readonly number[] | undefined;

/** A caller's coverage map: GLSL defining `atmCloudCoverageAt`, and its uniforms. */
export interface CloudCoverage {
  /**
   * Declares the caller's uniforms and defines `float atmCloudCoverageAt(vec2
   * xz)`: the local cover (0 … 1) at world x/z (metres).
   */
  readonly glsl: string;
  readonly uniforms: Record<string, THREE.IUniform>;
}

/**
 * The noise threshold for each cover k / 32, k = 0 … 32: `cloudThreshold`,
 * clear (2) at cover 0 and never above it. Computed once. The shader's
 * `atmCoverThresholds`. With `hex`, the hex-tiled field's
 * (`HEX_COVER_THRESHOLDS`, `cloud-hex.ts`), the shader's
 * `atmCoverThresholdsHex`: both are carried, the switch picks, so a live
 * switch rewrites no copy.
 */
export function cloudCoverThresholds(hex = false): readonly number[] {
  if (hex) {
    hexThresholds ??= HEX_COVER_THRESHOLDS.map((t) =>
      Math.min(t, CLEAR_THRESHOLD)
    );
    return hexThresholds;
  }
  coverThresholds ??= Array.from({ length: COVER_STEPS + 1 }, (_, k) =>
    Math.min(cloudThreshold(k / COVER_STEPS), CLEAR_THRESHOLD)
  );
  return coverThresholds;
}

/**
 * The threshold for a local `cover` (0 … 1, clamped), linear between the
 * table's entries. GLSL twin: `atmCoverThreshold`.
 *
 * @throws RangeError for a cover that is NaN.
 */
export function cloudThresholdForCover(cover: number, hex = false): number {
  if (Number.isNaN(cover)) {
    throw new RangeError('the cover must be a number, got NaN');
  }
  const table = cloudCoverThresholds(hex);
  const c = Math.min(Math.max(cover, 0), 1) * COVER_STEPS;
  const k = Math.min(Math.floor(c), COVER_STEPS - 1);
  const f = c - k;
  if (f === 0) return table[k]!;
  if (f === 1) return table[k + 1]!;
  return table[k]! + (table[k + 1]! - table[k]!) * f;
}

/**
 * The threshold `threshold` faded to clear (2) around the camera: unchanged
 * within 0.7 `radiusM` of it horizontally, clear from `radiusM`, smoothstep
 * between. GLSL twin: the disc in `atmCloudThresholdAt`.
 *
 * @throws RangeError for a radius that is not positive and finite, or a
 *   negative or NaN distance.
 */
export function cloudDiscThreshold(
  threshold: number,
  horizontalM: number,
  radiusM: number
): number {
  if (!(radiusM > 0 && Number.isFinite(radiusM))) {
    throw new RangeError(`the disc radius must be positive, got ${radiusM}`);
  }
  if (!(horizontalM >= 0)) {
    throw new RangeError(`the distance must be >= 0, got ${horizontalM}`);
  }
  const share = smoothstep(0.7 * radiusM, radiusM, horizontalM);
  return threshold + (CLEAR_THRESHOLD - threshold) * share;
}

/** Where a caller's coverage chunk goes (`withCloudCoverage`). */
const COVERAGE_CHUNK = '// atm-cloud-coverage-chunk';

/**
 * The chunk both shaders include: `atmCloudThresholdAt(xz, threshold,
 * cover)`, the threshold at world x/z, from the caller's map times `cover`
 * (`ATM_CLOUD_COVERAGE`, the caller's chunk inserted by
 * `withCloudCoverage`) or `threshold`, faded to clear around the camera
 * (`ATM_CLOUD_DISC`). Without either define it returns `threshold`.
 */
export const CLOUD_COVERAGE_GLSL = /* glsl */ `
#ifdef ATM_CLOUD_COVERAGE
uniform float atmCoverThresholds[33];
// The hex-tiled field's table (hex-tiling plan H1), picked by the switch.
uniform float atmCoverThresholdsHex[33];
${COVERAGE_CHUNK}
// Twin of cloudThresholdForCover.
float atmCoverThreshold(float cover, float hex) {
  float c = clamp(cover, 0.0, 1.0) * 32.0;
  int k = int(min(floor(c), 31.0));
  float plain = mix(atmCoverThresholds[k], atmCoverThresholds[k + 1], c - float(k));
  float tiled = mix(atmCoverThresholdsHex[k], atmCoverThresholdsHex[k + 1], c - float(k));
  return hex > 0.5 ? tiled : plain;
}
#endif
#ifdef ATM_CLOUD_DISC
uniform float atmCoverDiscM;
// The disc's centre: world x, z, and 1 to follow the camera instead.
uniform vec3 atmCoverDiscCentre;
#endif
float atmCloudThresholdAt(vec2 xz, float threshold, float cover, float hex) {
#ifdef ATM_CLOUD_COVERAGE
  threshold = atmCoverThreshold(atmCloudCoverageAt(xz) * cover, hex);
#endif
#ifdef ATM_CLOUD_DISC
  vec2 atmDiscCentre = mix(atmCoverDiscCentre.xy, cameraPosition.xz, atmCoverDiscCentre.z);
  threshold = mix(threshold, 2.0, smoothstep(0.7 * atmCoverDiscM, atmCoverDiscM, length(xz - atmDiscCentre)));
#endif
  return threshold;
}
`;

/**
 * The uniforms `CLOUD_COVERAGE_GLSL` declares, neutral (the table clear, a
 * 1 m disc) until a coverage and a disc are set: a shader that declares
 * them must be given them from the start.
 */
export function cloudCoverageUniforms(): {
  atmCoverThresholds: THREE.IUniform<number[]>;
  atmCoverThresholdsHex: THREE.IUniform<number[]>;
  atmCoverDiscM: THREE.IUniform<number>;
  atmCoverDiscCentre: THREE.IUniform<THREE.Vector3>;
} {
  return {
    atmCoverThresholds: {
      value: new Array<number>(COVER_STEPS + 1).fill(CLEAR_THRESHOLD),
    },
    atmCoverThresholdsHex: {
      value: new Array<number>(COVER_STEPS + 1).fill(CLEAR_THRESHOLD),
    },
    atmCoverDiscM: { value: 1 },
    // Following the camera (z = 1) until a centre is set.
    atmCoverDiscCentre: { value: new THREE.Vector3(0, 0, 1) },
  };
}

/**
 * `fragment` (which includes `CLOUD_COVERAGE_GLSL`) with the caller's
 * coverage chunk inserted.
 *
 * @throws RangeError for a chunk that does not define atmCloudCoverageAt, or
 *   a fragment without the chunk's place.
 */
export function withCloudCoverage(fragment: string, glsl: string): string {
  if (!/float\s+atmCloudCoverageAt\s*\(\s*vec2\s+\w+\s*\)/.test(glsl)) {
    throw new RangeError(
      'the coverage chunk must define float atmCloudCoverageAt(vec2 xz)'
    );
  }
  if (!fragment.includes(COVERAGE_CHUNK)) {
    throw new RangeError('the shader does not include CLOUD_COVERAGE_GLSL');
  }
  return fragment.replace(COVERAGE_CHUNK, glsl);
}

/** A disc centre: world x and z (m). */
export interface CloudDiscCentre {
  readonly x: number;
  readonly z: number;
}

/**
 * Writes a disc centre into the chunk's `atmCoverDiscCentre` uniform (globe
 * volume-cloud plan 2026-10-05-0016 §15): the world point, or the camera
 * (null), so the slab and the shadow agree on it.
 *
 * @throws RangeError for a centre that is not finite.
 */
export function writeCloudDiscCentre(
  uniform: THREE.IUniform<THREE.Vector3>,
  centre: CloudDiscCentre | null
): void {
  if (centre === null) {
    uniform.value.z = 1;
    return;
  }
  if (!(Number.isFinite(centre.x) && Number.isFinite(centre.z))) {
    throw new RangeError(
      `the disc centre must be finite, got ${centre.x}, ${centre.z}`
    );
  }
  uniform.value.set(centre.x, centre.z, 0);
}
