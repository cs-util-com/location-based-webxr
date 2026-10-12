/**
 * The spherical cloud volume's arithmetic (round-4 plan 2026-10-11-0122,
 * R4d / V1; DEC-R4-5 as reconciled with DEC-R3-6 in that plan's §6 item
 * 8): ONE ray-marched pass over a cloud shell around the Earth, from about
 * 700 km down to the slab's ceiling, whose parameters move with the
 * altitude, so the owner's "layers at 700 / 200 / 30 km" are its parameter
 * sets along the descent. Between two stations two fields of fixed cell
 * scales are mixed, weighted so their squares sum to 1 (the spread and the
 * opacity kept, no dip); a cell scale that slid with the altitude moved the
 * clouds by tens of km per percent of descent. The mix still morphs one
 * pattern into the other over each band (R4d milestone review, finding 3:
 * a departure from DEC-R3-6's "one field" the owner judges by eye).
 *
 * - `cloudShellVolumeLaw`: the pass's parameters at an altitude, each
 *   interpolated between the stations by a smoothstep in the altitude's
 *   logarithm, so each station's set is reached and held there.
 * - `cloudShellVolumeShares`: who draws the clouds at an altitude: the flat
 *   layer, the shell and the slab, sharing 1 (the C2 invariant over three
 *   drawers). The shell fades in over a band above its top as today's slab
 *   fades in below its ceiling; below the slab's ceiling the two are MIXED
 *   by the slab's share.
 * - `cloudShellColumn` and `GLOBE_CLOUD_SHELL_GLSL`: where a point of the
 *   shell reads the cloud map (its geodetic latitude and longitude, with
 *   the drift) and the noise (an azimuthal-equidistant chart around the
 *   frame's origin, which is the slab's local frame near it), CPU and GPU.
 *
 * Pure (three's matrices only). @see globe-cloud-shell-volume.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

import { smoothstep } from "./globe-ease.js";
import { cloudVolumeShare, gaussianRadiusKm } from "./globe-cloud-volume.js";
import { worldFromEcefAt } from "./globe-frame.js";
import type { LatLng } from "./globe-target.js";

/** One parameter set of the pass, at the altitude it applies fully. */
export interface CloudShellStation {
  /** The camera's altitude where this set applies, km. */
  readonly altitudeKm: number;
  /** March nodes along a ray through the deck. */
  readonly steps: number;
  /** The live noise's octaves read at most (a fractional one in part). */
  readonly octaves: number;
  /**
   * The field's cells times this (1: the slab's field, unscaled). Never
   * interpolated: a scale that changes with the altitude scales the
   * ground-anchored plane about its origin, thousands of kilometres away,
   * and the clouds slid by tens of kilometres a percent of descent
   * (measured: at 35 km, a scale of 1.01 against the slab's 1 read a
   * correlation of -0.05 with the slab's clouds, 0.999 at 1). Between two
   * stations the two FIELDS are mixed instead (`cellMix`, the spread kept).
   */
  readonly cellScale: number;
  /** The deck's thickness times this (1: the slab's 400 m deck). */
  readonly thicknessScale: number;
  /**
   * The column's rise per unit of noise above the threshold, times this
   * (1: the slab's). Below 1 the columns are flatter and the deck's edges
   * soft: where the noise is near the threshold the cloud is thin and
   * translucent, so far up the clouds read as the map's soft masses rather
   * than hard cells; the cover (the share of sky) is kept, since the
   * threshold is where a column's opacity is one half whatever the share.
   */
  readonly noiseShare: number;
  /**
   * The slab's aerial fade on the clouds (each segment's weight e^(-t /
   * 60 km)), as a share: 1 at the slab's station, so where the two are
   * mixed they draw the same far clouds; 0 high up, where the space pass's
   * veil is the only aerial perspective.
   */
  readonly aerial: number;
}

export const CLOUD_SHELL_VOLUME = {
  /**
   * The stations, highest first: the owner's 700 / 200 / 30 km. The bottom
   * one is the slab's own set (its march's 8 steps and 5 octaves, its field
   * and its deck), so where the two are mixed they draw the same clouds.
   */
  stations: [
    {
      altitudeKm: 700,
      steps: 4,
      octaves: 3,
      cellScale: 4,
      thicknessScale: 4,
      noiseShare: 0.35,
      aerial: 0,
    },
    {
      altitudeKm: 200,
      steps: 6,
      octaves: 4,
      cellScale: 2,
      thicknessScale: 2,
      // The top's square root (the lab's rule for the middle station).
      noiseShare: 0.59,
      aerial: 0,
    },
    {
      altitudeKm: 30,
      steps: 8,
      octaves: 5,
      cellScale: 1,
      thicknessScale: 1,
      noiseShare: 1,
      aerial: 1,
    },
  ] as const satisfies readonly CloudShellStation[],
  /**
   * The shell is full from here down, km (the owner's "about 700 km"; 800
   * since round 5, C5: "start at about 1,050 km while the texture is still
   * there").
   */
  topKm: 800,
  /** ... and fades in over this much above it, km (1,050 to 800 km). */
  bandKm: 250,
  /** The march's loop bound (the shader's constant). */
  maxSteps: 12,
  /** The live noise's octaves (the framework's seven). */
  maxOctaves: 7,
} as const;

/** The pass's parameters at an altitude (`cloudShellVolumeLaw`). */
export interface CloudShellVolumeParams {
  readonly steps: number;
  /** `steps` rounded: the march's whole node count. */
  readonly marchSteps: number;
  readonly octaves: number;
  readonly thicknessScale: number;
  readonly noiseShare: number;
  readonly aerial: number;
  /** The two fields' cell scales: the upper station's, the lower one's. */
  readonly cells: readonly [number, number];
  /** How far the mix has gone from the upper field to the lower, 0-1. */
  readonly cellMix: number;
}

/** The parameters interpolated between stations (the cells are mixed). */
const PARAMETERS = [
  "steps",
  "octaves",
  "thicknessScale",
  "noiseShare",
  "aerial",
] as const satisfies readonly (keyof CloudShellStation)[];

function requireStations(stations: readonly CloudShellStation[]): void {
  if (stations.length === 0) {
    throw new RangeError("the law needs at least one station");
  }
  const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  const positive = (v: number) => v > 0 && Number.isFinite(v);
  stations.forEach((s, i) => {
    const ok =
      positive(s.altitudeKm) &&
      within(s.steps, 1, CLOUD_SHELL_VOLUME.maxSteps) &&
      within(s.octaves, 1, CLOUD_SHELL_VOLUME.maxOctaves) &&
      positive(s.cellScale) &&
      positive(s.thicknessScale) &&
      within(s.noiseShare, 0, 1) &&
      within(s.aerial, 0, 1);
    if (!ok) {
      throw new RangeError(
        `station ${i} needs a positive altitude, steps 1-${CLOUD_SHELL_VOLUME.maxSteps}, octaves 1-${CLOUD_SHELL_VOLUME.maxOctaves}, positive scales, a noise share and an aerial share 0-1, got ${JSON.stringify(s)}`,
      );
    }
    if (i > 0 && !(s.altitudeKm < stations[i - 1]!.altitudeKm)) {
      throw new RangeError(
        `the stations must be ordered from the highest down, got ${stations[i - 1]!.altitudeKm} then ${s.altitudeKm}`,
      );
    }
  });
}

/**
 * The pass's parameters at `altitudeKm` (the camera's height over the
 * ellipsoid): the top station's set above it, the bottom one's below, and
 * between two stations a smoothstep in the altitude's logarithm, so each
 * set is reached exactly at its station and the change is continuous
 * (with a zero slope at every station). The cells are never interpolated:
 * `cells` names the two stations' scales and `cellMix` that same
 * smoothstep, by which the pass mixes the two fields (`cloudShellFieldWeights`). RangeError for an altitude that is
 * not finite, or stations that are empty, unordered or out of range.
 */
export function cloudShellVolumeLaw(
  altitudeKm: number,
  stations: readonly CloudShellStation[] = CLOUD_SHELL_VOLUME.stations,
): CloudShellVolumeParams {
  if (!Number.isFinite(altitudeKm)) {
    throw new RangeError(`the altitude must be finite, got ${altitudeKm}`);
  }
  requireStations(stations);
  const h = Math.max(altitudeKm, 1e-3);
  let upper = stations[0]!;
  let lower = upper;
  let t = 0;
  if (h <= stations.at(-1)!.altitudeKm) {
    upper = stations.at(-1)!;
    lower = upper;
  } else if (h < upper.altitudeKm) {
    for (let i = 0; i + 1 < stations.length; i++) {
      const hi = stations[i]!;
      const lo = stations[i + 1]!;
      if (h <= hi.altitudeKm && h >= lo.altitudeKm) {
        upper = hi;
        lower = lo;
        t = smoothstep(
          Math.log(hi.altitudeKm / h) / Math.log(hi.altitudeKm / lo.altitudeKm),
        );
        break;
      }
    }
  }
  const mixed = Object.fromEntries(
    PARAMETERS.map((f) => [f, upper[f] + (lower[f] - upper[f]) * t]),
  ) as Record<(typeof PARAMETERS)[number], number>;
  return {
    ...mixed,
    marchSteps: Math.round(mixed.steps),
    cells: [upper.cellScale, lower.cellScale],
    cellMix: upper.cellScale === lower.cellScale ? 0 : t,
  };
}

/**
 * The two fields' weights at a mix `t` (0-1), their squares summing to 1:
 * two fields of one spread, nearly uncorrelated, mixed as wa (a - mean) +
 * wb (b - mean) keep that spread, so the cover the thresholds draw and the
 * opacity hold through the mix (a plain (1 - t) a + t b would halve the
 * variance at t = 0.5 and thin the clouds there). RangeError outside 0-1.
 */
export function cloudShellFieldWeights(t: number): [number, number] {
  if (!(t >= 0 && t <= 1)) {
    throw new RangeError(`the mix must be 0-1, got ${t}`);
  }
  const n = Math.hypot(1 - t, t);
  return [(1 - t) / n, t / n];
}

/** Who draws the clouds at an altitude (`cloudShellVolumeShares`). */
export interface CloudShellVolumeShares {
  /** The shell's own fade-in above its top (its coverage's factor), 0-1. */
  readonly shellIn: number;
  /** The flat layer's share as a drawer (before its own weakening), 0-1. */
  readonly flat: number;
  /** The shell's weight in the mix with the slab, 0-1. */
  readonly shell: number;
  /** The slab's weight (its altitude share, `cloudVolumeShare`), 0-1. */
  readonly slab: number;
}

/**
 * Who draws the clouds at `altitudeKm`, sharing 1: the slab its share
 * below its ceiling (`cloudVolumeShare` with `ceilingKm`, `fadeKm`); the
 * shell the rest of what it has faded in (`shellIn`: 0 at and above
 * `topKm + bandKm`, 1 at and below `topKm`, a smoothstep between, the
 * slab's form); the flat layer what is left. `topKm` 0 turns the shell off
 * (the slab's hand-over alone). RangeError for an altitude that is not
 * finite, a band that is not positive, or a top (other than 0) at or below
 * the slab's ceiling.
 */
export function cloudShellVolumeShares(
  altitudeKm: number,
  options: {
    readonly topKm: number;
    readonly bandKm?: number;
    readonly ceilingKm: number;
    readonly fadeKm: number;
  },
): CloudShellVolumeShares {
  const { topKm, bandKm = CLOUD_SHELL_VOLUME.bandKm, ceilingKm } = options;
  if (!Number.isFinite(altitudeKm)) {
    throw new RangeError(`the altitude must be finite, got ${altitudeKm}`);
  }
  if (topKm !== 0 && !(bandKm > 0 && topKm > ceilingKm)) {
    throw new RangeError(
      `the shell needs a positive band and a top above the slab's ceiling, got ${bandKm}, ${topKm} over ${ceilingKm}`,
    );
  }
  const slab =
    ceilingKm > 0
      ? cloudVolumeShare(altitudeKm, {
          ceilingKm,
          fadeKm: Math.min(options.fadeKm, ceilingKm),
        })
      : 0;
  const shellIn =
    topKm === 0
      ? 0
      : cloudVolumeShare(altitudeKm, {
          ceilingKm: topKm + bandKm,
          fadeKm: bandKm,
        });
  const shell = shellIn * (1 - slab);
  return { shellIn, flat: (1 - shellIn) * (1 - slab), shell, slab };
}

/** One field of the noise cascade: its fixed cell scale and its offset. */
interface CloudShellNoiseField {
  /** The cells' size over the slab's (1 the slab's own). */
  readonly scale: number;
  /** Its lattice offset in cells: a decorrelated field; [0, 0] the slab's. */
  readonly offsetCells: readonly [number, number];
}

/** The cascade's fields and their weights at an altitude. */
export interface CloudShellNoiseCascade {
  /** The first field's place in the cascade (0 the top). */
  readonly index: number;
  /** The field at `index` and the next one (only one at the bottom). */
  readonly fields: readonly CloudShellNoiseField[];
  /** Their weights, cos and sin of the progress: squares sum to 1. */
  readonly weights: readonly [number, number];
}

/** RangeError for the cascade's refused inputs (`cloudShellNoiseCascade`). */
function assertCascade(
  altitudeKm: number,
  options: {
    readonly topKm: number;
    readonly bottomKm: number;
    readonly fields: number;
    readonly topScale: number;
  },
): void {
  const { topKm, bottomKm, fields, topScale } = options;
  if (!(altitudeKm >= 0 && Number.isFinite(altitudeKm))) {
    throw new RangeError(
      `the altitude must be >= 0 and finite, got ${altitudeKm}`,
    );
  }
  if (!(bottomKm > 0 && topKm > bottomKm && Number.isFinite(topKm))) {
    throw new RangeError(
      `the cascade needs 0 < bottom < top, got ${bottomKm}, ${topKm}`,
    );
  }
  if (!(Number.isInteger(fields) && fields >= 1)) {
    throw new RangeError(
      `the cascade needs a whole number of fields >= 1, got ${fields}`,
    );
  }
  if (!(topScale >= 1 && Number.isFinite(topScale))) {
    throw new RangeError(`the top scale must be >= 1, got ${topScale}`);
  }
}

/**
 * The shell's noise along the descent (round-5 plan 2026-10-12-0612 C2):
 * `fields` + 1 fields from `topKm` down to `bottomKm`, each at a fixed
 * cell scale (falling geometrically from `topScale` to 1) and its own
 * lattice offset (decorrelated), the last the slab's own field (scale 1,
 * no offset). The progress m runs linearly in the altitude's logarithm
 * from 0 at the top to `fields` at the bottom; between fields k and k + 1
 * the weights are cos and sin of (pi / 2) frac(m). So the squares sum to 1
 * (no opacity dip, the two fields being independent) and the mix turns at
 * the same angular speed at every altitude (no static stretch, the owner's
 * "nothing moves between 300 and 150 km" under the station law's
 * smoothstep). A cell scale never slides: each field keeps its own.
 *
 * @throws RangeError for a negative or NaN altitude, a bottom not below a
 *   positive top, no field, or a top scale below 1.
 */
export function cloudShellNoiseCascade(
  altitudeKm: number,
  options: {
    readonly topKm: number;
    readonly bottomKm: number;
    readonly fields: number;
    readonly topScale: number;
  },
): CloudShellNoiseCascade {
  const { topKm, bottomKm, fields, topScale } = options;
  assertCascade(altitudeKm, options);
  const field = (k: number): CloudShellNoiseField => ({
    scale: topScale ** (1 - k / fields),
    // Whole cells, far apart, none for the slab's field (k = fields).
    offsetCells: [173 * (fields - k), 97 * (fields - k)],
  });
  const span = Math.log(topKm / bottomKm);
  const m =
    altitudeKm <= bottomKm
      ? fields
      : Math.min(
          fields,
          Math.max(0, Math.log(topKm / altitudeKm) / span) * fields,
        );
  if (m >= fields) {
    return { index: fields, fields: [field(fields)], weights: [1, 0] };
  }
  const index = Math.floor(m);
  const t = (Math.PI / 2) * (m - index);
  return {
    index,
    fields: [field(index), field(index + 1)],
    weights: [Math.cos(t), Math.sin(t)],
  };
}

/**
 * The law's stations from a page's knobs (R4d milestone review, findings 9
 * and 11): the top where `topKm` puts it with the knobs' cell scale,
 * thickness and noise share, the middle at `midKm` with their square
 * roots, and the bottom (the slab's own set) at the slab's ceiling or the
 * module's 30 km, whichever is higher, so from the ceiling down the shell
 * draws the slab's single field. Each station is kept at least 1.5x the one
 * below, so the law and the shares never refuse what the knobs give.
 *
 * @throws RangeError for a knob that is not positive and finite.
 */
export function cloudShellStationsFor(knobs: {
  readonly topKm: number;
  readonly midKm: number;
  readonly cellScale: number;
  readonly thicknessScale: number;
  readonly noiseShare: number;
  readonly ceilingKm: number;
}): CloudShellStation[] {
  for (const [name, v] of Object.entries(knobs)) {
    if (!(v > 0 && Number.isFinite(v))) {
      throw new RangeError(`the ${name} must be positive and finite, got ${v}`);
    }
  }
  const [top, mid, bottom] = CLOUD_SHELL_VOLUME.stations;
  const bottomKm = Math.max(bottom.altitudeKm, knobs.ceilingKm);
  const midKm = Math.max(
    Math.min(knobs.midKm, knobs.topKm / 1.5),
    bottomKm * 1.5,
  );
  const topKm = Math.max(knobs.topKm, midKm * 1.5);
  return [
    {
      ...top,
      altitudeKm: topKm,
      cellScale: knobs.cellScale,
      thicknessScale: knobs.thicknessScale,
      noiseShare: knobs.noiseShare,
    },
    {
      ...mid,
      altitudeKm: midKm,
      cellScale: Math.sqrt(knobs.cellScale),
      thicknessScale: Math.sqrt(knobs.thicknessScale),
      noiseShare: Math.sqrt(knobs.noiseShare),
    },
    { ...bottom, altitudeKm: bottomKm },
  ];
}

/**
 * The shell's weight at one pixel in its mix with the slab (R4d milestone
 * review, finding 1; round-5 plan 2026-10-12-0612): `shellIn` x (1 -
 * `slab` x r), r = min(1, `slabAlpha` / `shellAlpha`), the share of the
 * shell's cloud the slab draws at this pixel (1 where the shell draws
 * none). Where the two draw the same cloud this is the hand-over's 1 -
 * `slab`; where the slab draws less (its disc's fade ring, beyond its
 * disc, a clear patch) the shell fills the difference, so the mix's alpha
 * is never below the shell's (C2 per pixel). A disc mask in its place
 * missed the slab's faster fade in its ring (its threshold rises, so its
 * clouds go before its weight does). GLSL twin: the lab's composite.
 *
 * @throws RangeError for a share or an alpha outside 0..1.
 */
export function cloudShellPixelWeight(input: {
  readonly shellIn: number;
  readonly slab: number;
  readonly shellAlpha: number;
  readonly slabAlpha: number;
}): number {
  for (const [name, v] of Object.entries(input)) {
    if (!(v >= 0 && v <= 1)) {
      throw new RangeError(`the ${name} must be in 0..1, got ${v}`);
    }
  }
  const { shellIn, slab, shellAlpha, slabAlpha } = input;
  const r = shellAlpha > 0 ? Math.min(1, slabAlpha / shellAlpha) : 1;
  return shellIn * (1 - slab * r);
}

/**
 * What the chart and the map read need of the world frame: the frame
 * (`worldFromEcefAt` at the target: x east, y up, z south, metres, the
 * origin on the ground), the ellipsoid's radii (m), the model sphere's
 * radius (km; the atmosphere pass's frame, where the ellipsoid is that
 * sphere) and the Gaussian radius at the target (m), which takes a chord
 * back to its arc.
 */
export interface CloudShellFrame {
  readonly worldFromEcef: THREE.Matrix4;
  readonly radii: readonly [number, number, number];
  readonly groundKm: number;
  readonly gaussianRadiusM: number;
}

/**
 * The frame the shell's chart is drawn around, at `target` (degrees), for
 * a model sphere of `groundKm`. RangeError for a target off the globe or a
 * radius that is not positive.
 */
export function cloudShellFrame(
  ellipsoid: Ellipsoid,
  target: LatLng,
  groundKm: number,
  out: THREE.Matrix4 = new THREE.Matrix4(),
): CloudShellFrame {
  if (!(groundKm > 0 && Number.isFinite(groundKm))) {
    throw new RangeError(
      `the model's radius must be positive, got ${groundKm}`,
    );
  }
  worldFromEcefAt(ellipsoid, target, out);
  const { x, y, z } = ellipsoid.radius;
  return {
    worldFromEcef: out,
    radii: [x, y, z],
    groundKm,
    gaussianRadiusM: gaussianRadiusKm(target.lat * DEG) * 1000,
  };
}

/** Where a shell point reads the map and the noise (`cloudShellColumn`). */
export interface CloudShellColumn {
  /** Its height over the model sphere, km. */
  readonly heightKm: number;
  /** Its geodetic latitude and longitude, radians. */
  readonly latRad: number;
  readonly lonRad: number;
  /** The cloud map's uv there, the drift taken off u (not wrapped). */
  readonly uv: readonly [number, number];
  /**
   * The ground point under it on the chart around the frame's origin, km:
   * x east and z south as the frame's local axes near the origin, the
   * ground distance from it along the geodesic's first heading further out.
   */
  readonly chartKm: readonly [number, number];
}

const DEG = Math.PI / 180;
const ground = new THREE.Vector3();

/**
 * The CPU twin of `GLOBE_CLOUD_SHELL_GLSL` for a point `pointKm` of the
 * model frame (the ECEF axes, each scaled so the ellipsoid is the model
 * sphere): its geodetic latitude and longitude from the normal
 * normalize(p / radii) (the ellipsoid's normal at the point's parametric
 * foot, which the surface reads the map at), the map's uv with the drift
 * `lonOffsetRad` taken off, and the chart of its radial foot. RangeError
 * for a point that is not finite or is the centre.
 */
export function cloudShellColumn(
  pointKm: readonly [number, number, number],
  frame: CloudShellFrame,
  lonOffsetRad: number,
): CloudShellColumn {
  const [px, py, pz] = pointKm;
  const r = Math.hypot(px, py, pz);
  if (!(Number.isFinite(r) && r > 0 && Number.isFinite(lonOffsetRad))) {
    throw new RangeError(
      `the point must be finite and off the centre, got ${pointKm.join(", ")}, drift ${lonOffsetRad}`,
    );
  }
  const [a, b, c] = frame.radii;
  const nx = px / a;
  const ny = py / b;
  const nz = pz / c;
  const n = Math.hypot(nx, ny, nz);
  const latRad = Math.asin(Math.min(1, Math.max(-1, nz / n)));
  const lonRad = Math.atan2(ny, nx);
  const s = frame.groundKm / r;
  ground
    .set(
      (px * s * a) / frame.groundKm,
      (py * s * b) / frame.groundKm,
      (pz * s * c) / frame.groundKm,
    )
    .applyMatrix4(frame.worldFromEcef);
  const chord = ground.length();
  const rho = Math.hypot(ground.x, ground.z);
  const g = frame.gaussianRadiusM;
  const arc = 2 * g * Math.asin(Math.min(1, chord / (2 * g)));
  const k = rho > 1e-3 ? arc / rho / 1000 : 0;
  return {
    heightKm: r - frame.groundKm,
    latRad,
    lonRad,
    uv: [(lonRad - lonOffsetRad) / (2 * Math.PI) + 0.5, latRad / Math.PI + 0.5],
    chartKm: [ground.x * k, ground.z * k],
  };
}

/**
 * The GLSL twin of `cloudShellColumn`, for a pass marching in the model
 * frame (km): `globeShellMapUv(p)` and `globeShellChartKm(p)`. Uniforms:
 * `uShellWorldFromEcef` (the frame, `CloudShellFrame.worldFromEcef`),
 * `uShellRadii` (m), `uShellGroundKm`, `uShellGaussianM` and
 * `uShellLonOffset` (the map's drift, radians). float32: the frame's
 * product of 6,400 km numbers leaves about a metre, under the finest
 * octave the march reads (690 m cells).
 */
export const GLOBE_CLOUD_SHELL_GLSL = /* glsl */ `
uniform mat4 uShellWorldFromEcef;
uniform vec3 uShellRadii;
uniform float uShellGroundKm;
uniform float uShellGaussianM;
uniform float uShellLonOffset;
vec2 globeShellMapUv( vec3 p ) {
  vec3 n = normalize( p / uShellRadii );
  float lon = atan( n.y, n.x );
  float lat = asin( clamp( n.z, -1.0, 1.0 ) );
  return vec2( ( lon - uShellLonOffset ) * 0.15915494309189535 + 0.5, lat * 0.3183098861837907 + 0.5 );
}
vec2 globeShellChartKm( vec3 p ) {
  vec3 g = normalize( p ) * uShellRadii;
  vec3 l = ( uShellWorldFromEcef * vec4( g, 1.0 ) ).xyz;
  float chord = length( l );
  float rho = length( l.xz );
  float arc = 2.0 * uShellGaussianM * asin( min( 1.0, chord / ( 2.0 * uShellGaussianM ) ) );
  return rho > 1e-3 ? l.xz * ( arc / rho * 0.001 ) : vec2( 0.0 );
}`;
