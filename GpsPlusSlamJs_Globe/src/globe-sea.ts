/**
 * The globe's sea: waves whose slopes the pixel resolves, the rest of the
 * slopes as Cox-Munk statistics, Fresnel, Smith masking, the sky reflected
 * from the production atmosphere's tables and the sun's glint. It replaces
 * the imagery's water near the sea and hands over to the flat glint with
 * height. Clear sky only: a shadow reaches it through one named function.
 *
 * @see globe-sea.ts.md
 */
import { ATMOSPHERE_COMMON_GLSL } from "gps-plus-slam-app-framework/visualization/atmosphere/atmosphere-glsl";
import * as THREE from "three";

export const GLOBE_SEA = Object.freeze({
  /** The wind for the slope statistics (m/s). */
  windMps: 5,
  /** The wind's heading, as east and north shares. */
  windEastNorth: Object.freeze([0.28, -0.96] as const),
  /** The camera's height at which the sea is whole, and gone (km). */
  fadeKm: Object.freeze([20, 60] as const),
  /** Noise cells before an octave repeats: its phase wraps by this. */
  noiseCells: 256,
  /** The most octaves any quality sums (the phase uniform's size). */
  maxOctaves: 8,
  /** The waves' turn per octave (radians). */
  octaveTurnRad: 1.7 * 0.35,
  /** Noise cells stretched across the waves, so they read as crests. */
  crossStretch: 1.6,
  /** The octaves' waves run this much faster than deep-water waves. */
  speedGain: 1.6,
  /** Each octave's noise cells apart, so they do not line up. */
  octaveOffset: 13.7,
});

/** What the sea takes from a quality tier. */
export interface GlobeSeaOptions {
  /** How many wave octaves the shader sums, each twice the last. */
  readonly waveOctaves: number;
  /** The shortest explicit wave (m). */
  readonly shortestWaveM: number;
}

/** The sea's part of the surface's uniforms. */
export interface GlobeSeaUniforms {
  /** The sea's share of a water pixel now: 0 (off) to 1. */
  readonly uSeaOn: { value: number };
  /** Directions from the camera's frame into ECEF. */
  readonly uSeaEcefFromView: { value: THREE.Matrix3 };
  /** The wind at the camera: an ECEF unit vector in the sea's plane. */
  readonly uSeaWind: { value: THREE.Vector3 };
  /** Each octave's noise offset, wrapped into the noise's period. */
  readonly uSeaPhase: { value: THREE.Vector2[] };
  /** The shortest explicit wave (m). */
  readonly uSeaShortestM: { value: number };
  /** One pixel's angle (radians). */
  readonly uSeaPixelRad: { value: number };
  /** The atmosphere's sky-view table. */
  readonly uSeaSkyView: { value: THREE.Texture };
  /** The atmosphere's transmittance table. */
  readonly uSeaTransmittance: { value: THREE.Texture };
  /** The radius the sky-view table was drawn for (km). */
  readonly uSeaObserverR: { value: number };
  /** The atmosphere's radiance to the scene's units. */
  readonly uSeaRadianceToScene: { value: number };
}

/** The atmosphere's shared uniforms, as far as the sea reads them. */
interface GlobeSeaSky {
  readonly atmSkyViewLut: { readonly value: THREE.Texture };
  readonly atmTransmittanceLut: { readonly value: THREE.Texture };
  readonly atmObserverRadius: { readonly value: number };
  readonly atmRadianceToScene: { readonly value: number };
}

export function createGlobeSeaUniforms(): GlobeSeaUniforms {
  return {
    uSeaOn: { value: 0 },
    uSeaEcefFromView: { value: new THREE.Matrix3() },
    uSeaWind: { value: new THREE.Vector3(1, 0, 0) },
    uSeaPhase: {
      value: Array.from(
        { length: GLOBE_SEA.maxOctaves },
        () => new THREE.Vector2(),
      ),
    },
    uSeaShortestM: { value: 8 },
    uSeaPixelRad: { value: 0.001 },
    uSeaSkyView: { value: new THREE.Texture() },
    uSeaTransmittance: { value: new THREE.Texture() },
    uSeaObserverR: { value: 6361 },
    uSeaRadianceToScene: { value: 0 },
  };
}

/** The sea's share at a camera height (km): 0 for one not known. */
export function globeSeaShareAt(altitudeKm: number): number {
  if (!Number.isFinite(altitudeKm)) return 0;
  const [low, high] = GLOBE_SEA.fadeKm;
  const t = Math.min(1, Math.max(0, (altitudeKm - low) / (high - low)));
  return 1 - t * t * (3 - 2 * t);
}

/** Cox and Munk's slope variances along and across the wind. */
export function seaSlopeVariance(windMps: number): {
  upwind: number;
  crosswind: number;
} {
  return {
    upwind: 0.00316 * windMps + 0.004,
    crosswind: 0.003 + 0.00192 * windMps,
  };
}

/** Unpolarised Fresnel reflectance of water at a cosine (the shader's). */
export function seaFresnel(cosine: number): number {
  const n = 1.333;
  const g = Math.sqrt(Math.max(0, n * n - 1 + cosine * cosine));
  const a = (g - cosine) / (g + cosine);
  const b = (cosine * (g + cosine) - 1) / (cosine * (g - cosine) + 1);
  return 0.5 * a * a * (1 + b * b);
}

/** An octave's wave length (m). */
const waveLength = (octave: number, shortestWaveM: number) =>
  shortestWaveM * 2 ** octave;

/** Metres in the wind's frame into an octave's unscaled noise frame. */
function octaveFrame(
  [x, y]: readonly [number, number],
  octave: number,
): [number, number] {
  const turn = octave * GLOBE_SEA.octaveTurnRad;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return [c * x + s * y, (-s * x + c * y) * GLOBE_SEA.crossStretch];
}

/**
 * An octave's noise offset for a camera `cameraWindM` metres along the
 * wind's frame at `timeS`, wrapped into the noise's period: every large
 * number stays here in doubles and the shader adds a small one.
 */
export function seaWavePhase(
  cameraWindM: readonly [number, number],
  timeS: number,
  octave: number,
  shortestWaveM: number,
): [number, number] {
  const lam = waveLength(octave, shortestWaveM);
  const speed = Math.sqrt((9.81 * lam) / (2 * Math.PI)) * GLOBE_SEA.speedGain;
  const [x, y] = octaveFrame(cameraWindM, octave);
  const wrap = (v: number) => {
    const m = v % GLOBE_SEA.noiseCells;
    const up = m < 0 ? m + GLOBE_SEA.noiseCells : m;
    return up >= GLOBE_SEA.noiseCells ? 0 : up;
  };
  return [
    wrap((x - speed * timeS) / lam),
    wrap(y / lam - octave * GLOBE_SEA.octaveOffset),
  ];
}

/**
 * A point `pointWindM` metres from the camera, along the wind's frame, in
 * an octave's noise: the shader's coordinate, as `seaWavePhase` feeds it.
 */
export function seaWaveCoord(
  pointWindM: readonly [number, number],
  phase: readonly [number, number],
  octave: number,
  shortestWaveM: number,
): [number, number] {
  const lam = waveLength(octave, shortestWaveM);
  const [x, y] = octaveFrame(pointWindM, octave);
  return [x / lam + phase[0], y / lam + phase[1]];
}

/**
 * THE SEA'S SHADOW INTERFACE: how much of the sun reaches the sea here, 1
 * in the open. `cloudShadow` is the surface's own shadow value at the
 * point; the near clouds' shadow arrives by changing this one function.
 */
export const GLOBE_SEA_SHADOW_GLSL = /* glsl */ `
float globeSeaSunShadow( float cloudShadow ) {
  return 1.0 - uCloudShadow * cloudShadow;
}`;

/**
 * The atmosphere's table look-ups under names of their own: the relief's
 * haze declares the same code in the same program. One implementation,
 * the framework's, so the sea reads the tables as the sky draws them.
 */
const SEA_ATMOSPHERE_GLSL = ATMOSPHERE_COMMON_GLSL.replace(
  /\batm(?=[A-Z])/g,
  "seaAtm",
).replace(/\bATM_/g, "SEA_ATM_");

const SLOPES = seaSlopeVariance(GLOBE_SEA.windMps);

/** The sea's uniforms and functions, after the surface's declarations. */
export const GLOBE_SEA_DECLARATIONS_GLSL = /* glsl */ `
uniform float uSeaOn;
uniform mat3 uSeaEcefFromView;
uniform vec3 uSeaWind;
uniform vec2 uSeaPhase[GLOBE_SEA_OCTAVES];
uniform float uSeaShortestM;
uniform float uSeaPixelRad;
uniform sampler2D uSeaSkyView;
uniform sampler2D uSeaTransmittance;
uniform float uSeaObserverR;
uniform float uSeaRadianceToScene;
float globeMapShare = 0.0;
${SEA_ATMOSPHERE_GLSL}
${GLOBE_SEA_SHADOW_GLSL}
uint globeSeaHash( ivec2 p ) {
  uvec2 q = uvec2( p ) * uvec2( 1597334673u, 3812015801u );
  uint n = ( q.x ^ q.y ) * 1597334673u;
  n ^= n >> 16; n *= 2246822519u; n ^= n >> 13;
  return n;
}
vec2 globeSeaGrad( ivec2 p ) {
  uint h = globeSeaHash( p & ${GLOBE_SEA.noiseCells - 1} );
  return vec2( float( h & 0xffffu ), float( h >> 16 ) ) * ( 2.0 / 65535.0 ) - 1.0;
}
// Gradient noise's derivatives, periodic in the noise's cells.
vec2 globeSeaNoiseSlope( vec2 p ) {
  ivec2 i = ivec2( floor( p ) ); vec2 f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 du = 30.0 * f * f * ( f * ( f - 2.0 ) + 1.0 );
  vec2 ga = globeSeaGrad( i ), gb = globeSeaGrad( i + ivec2( 1, 0 ) );
  vec2 gc = globeSeaGrad( i + ivec2( 0, 1 ) ), gd = globeSeaGrad( i + ivec2( 1, 1 ) );
  float va = dot( ga, f ), vb = dot( gb, f - vec2( 1, 0 ) );
  float vc = dot( gc, f - vec2( 0, 1 ) ), vd = dot( gd, f - vec2( 1, 1 ) );
  float k = va - vb - vc + vd;
  return ga + u.x * ( gb - ga ) + u.y * ( gc - ga ) + u.x * u.y * ( ga - gb - gc + gd )
    + du * ( u.yx * k + vec2( vb, vc ) - va );
}
float globeSeaSmith( float mu, float s ) {
  float a = mu / ( s * sqrt( max( 1e-4, 1.0 - mu * mu ) ) );
  return a < 1.6 ? ( 1.0 - 1.259 * a + 0.396 * a * a ) / ( 3.535 * a + 2.181 * a * a ) : 0.0;
}
float globeSeaFresnel( float c ) {
  float g = sqrt( max( 0.0, 0.776889 + c * c ) );
  float a = ( g - c ) / ( g + c ), b = ( c * ( g + c ) - 1.0 ) / ( c * ( g - c ) + 1.0 );
  return 0.5 * a * a * ( 1.0 + b * b );
}
// The sky in an ECEF direction, for a pixel with up N, in scene units.
vec3 globeSeaSky( vec3 dir, vec3 N, vec3 sunEast ) {
  vec3 local = vec3( dot( dir, sunEast ), dot( dir, N ), dot( dir, cross( sunEast, N ) ) );
  vec2 uv = seaAtmSkyViewUv( uSeaObserverR, seaAtmHorizonClampedDir( local ), vec3( 1.0, 0.0, 0.0 ) );
  return texture2D( uSeaSkyView, uv ).rgb * uSeaRadianceToScene;
}
// P: the pixel from the camera (ECEF, m); V: to the camera; N: up there;
// L: to the sun; shadow: globeSeaSunShadow's.
vec3 globeSeaShade( vec3 P, vec3 V, vec3 N, vec3 L, float shadow ) {
  const float su2 = ${SLOPES.upwind.toFixed(6)};
  const float sc2 = ${SLOPES.crosswind.toFixed(6)};
  const float s2 = 0.5 * ( su2 + sc2 );
  const float PER_OCTAVE = 0.13;
  vec3 Wt = normalize( uSeaWind - N * dot( N, uSeaWind ) );
  vec3 Wc = cross( N, Wt );
  float muV = max( dot( V, N ), 1e-3 );
  float fpm = length( P ) * uSeaPixelRad * inversesqrt( max( muV, 0.04 ) );
  vec2 xm = vec2( dot( P, Wt ), dot( P, Wc ) );
  vec2 slope = vec2( 0.0 );
  float resolved = 0.0;
  float lam = uSeaShortestM;
  for ( int i = 0; i < GLOBE_SEA_OCTAVES; i++ ) {
    float w = smoothstep( 1.2, 3.5, lam / fpm );
    if ( w > 0.0 ) {
      float turn = float( i ) * ${GLOBE_SEA.octaveTurnRad.toFixed(6)};
      mat2 rot = mat2( cos( turn ), -sin( turn ), sin( turn ), cos( turn ) );
      vec2 q = rot * xm;
      q.y *= ${GLOBE_SEA.crossStretch.toFixed(4)};
      vec2 g = globeSeaNoiseSlope( q / lam + uSeaPhase[ i ] );
      g.y *= ${GLOBE_SEA.crossStretch.toFixed(4)};
      slope += w * sqrt( PER_OCTAVE * s2 ) * 1.2 * ( transpose( rot ) * g );
      resolved += w * w * PER_OCTAVE * s2;
    }
    lam *= 2.0;
  }
  float k = max( 0.18, 1.0 - resolved / s2 );
  float ru2 = su2 * k, rc2 = sc2 * k;
  float muL = dot( L, N );
  vec3 sunEast = L - N * muL;
  float sunEastLength = length( sunEast );
  sunEast = sunEastLength > 1e-5 ? sunEast / sunEastLength : Wt;
  vec3 sun = seaAtmSampleTransmittance( uSeaTransmittance, SEA_ATM_GROUND_RADIUS + 0.01, muL )
    * SEA_ATM_RADIANCE_SCALE * uSeaRadianceToScene;
  vec3 H = normalize( V + L );
  float hz = max( dot( H, N ), 1e-3 );
  vec2 rel = -vec2( dot( H, Wt ), dot( H, Wc ) ) / hz - slope;
  float pdf = exp( -0.5 * ( rel.x * rel.x / ru2 + rel.y * rel.y / rc2 ) ) / ( 6.2831853 * sqrt( ru2 * rc2 ) );
  float sr = sqrt( 0.5 * ( ru2 + rc2 ) );
  float G = 1.0 / ( 1.0 + globeSeaSmith( muV, sr ) + globeSeaSmith( max( muL, 1e-3 ), sr ) );
  float Fg = globeSeaFresnel( clamp( dot( V, H ), 0.0, 1.0 ) );
  vec3 glint = sun * pdf * Fg * G / ( 4.0 * muV * hz * hz * hz * hz ) * shadow;
  vec3 Ne = normalize( N - slope.x * Wt - slope.y * Wc );
  vec3 R = reflect( -V, Ne );
  float up = dot( R, N );
  if ( up < 0.02 ) R = normalize( R + N * ( 0.02 - up ) );
  float F = globeSeaFresnel( clamp( max( dot( V, Ne ), sr * 0.55 ), 0.0, 1.0 ) );
  vec3 irradiance = sun * max( muL, 0.0 ) * shadow + 3.14159265 * globeSeaSky( N, N, sunEast );
  vec3 body = ( 1.0 - F ) * irradiance * vec3( 0.0013, 0.0032, 0.0062 );
  return F * globeSeaSky( R, N, sunEast ) + glint + body;
}`;

/**
 * Over the lit surface: the sea takes a water pixel, as far as the height
 * (`uSeaOn`), the coast's mask, a painted cloud and the drawn map leave it.
 */
export const GLOBE_SEA_FRAGMENT_GLSL = /* glsl */ `
float globeSeaWater = uSeaOn * smoothstep( 0.5, 1.0, globeWater )
  * ( 1.0 - globeCloud * uCloudOpacity * uCloudInSurface ) * ( 1.0 - globeMapShare );
if ( globeSeaWater > 0.0 ) {
  vec3 globeSeaView = uSeaEcefFromView * vViewPosition;
  outgoingLight = mix(
    outgoingLight,
    globeSeaShade( -globeSeaView, normalize( globeSeaView ), globeN, uSunEcef, globeSeaSunShadow( globeShellShadow ) ),
    globeSeaWater
  );
}`;

/** One frame of the sea. */
interface GlobeSeaFrame {
  /** The camera in ECEF (m). */
  readonly position: THREE.Vector3;
  /** The camera's rotation in ECEF. */
  readonly quaternion: THREE.Quaternion;
  /** The camera's height (km). */
  readonly altitudeKm: number;
  /** The clock (s); the waves run on it. */
  readonly timeS: number;
  /** One pixel's angle (radians). */
  readonly pixelRad: number;
}

export interface GlobeSea {
  /** The sky to reflect, or null: without one the sea stays off. */
  setSky(sky: GlobeSeaSky | null): void;
  /** The switch: off leaves the flat globe's glint. */
  setOn(on: boolean): void;
  /** Per frame, before the scene's draw. RangeError for a bad time. */
  step(frame: GlobeSeaFrame): void;
  state(): {
    on: boolean;
    sky: boolean;
    share: number;
    octaves: number;
    shortestWaveM: number;
  };
}

/** The wind at `position`: east and north there, in the wind's heading. */
function windAt(position: THREE.Vector3, target: THREE.Vector3): void {
  const up = position.clone().normalize();
  const east = new THREE.Vector3(-up.y, up.x, 0);
  // At a pole "east" has no meaning; any tangent will do.
  if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
  east.normalize();
  const north = up.clone().cross(east);
  const [e, n] = GLOBE_SEA.windEastNorth;
  target.copy(east).multiplyScalar(e).addScaledVector(north, n).normalize();
}

/** Keeps `uniforms` per frame. RangeError for a quality it cannot draw. */
export function createGlobeSea(
  uniforms: GlobeSeaUniforms,
  options: GlobeSeaOptions,
): GlobeSea {
  const { waveOctaves, shortestWaveM } = options;
  if (
    !Number.isInteger(waveOctaves) ||
    waveOctaves < 1 ||
    waveOctaves > GLOBE_SEA.maxOctaves
  ) {
    throw new RangeError(
      `the sea's octaves must be 1-${GLOBE_SEA.maxOctaves}, got ${waveOctaves}`,
    );
  }
  if (!(Number.isFinite(shortestWaveM) && shortestWaveM > 0)) {
    throw new RangeError(
      `the sea's shortest wave must be finite and > 0, got ${shortestWaveM}`,
    );
  }
  uniforms.uSeaShortestM.value = shortestWaveM;
  uniforms.uSeaPhase.value.length = waveOctaves;
  let on = true;
  let sky: GlobeSeaSky | null = null;
  /** The camera's travel over the sea, along the wind's frame (m). */
  const travel: [number, number] = [0, 0];
  const last = new THREE.Vector3();
  let hasLast = false;
  const wind = new THREE.Vector3();
  const across = new THREE.Vector3();
  const moved = new THREE.Vector3();
  const rotation = new THREE.Matrix4();
  return {
    setSky(next) {
      sky = next;
    },
    setOn(next) {
      on = next;
    },
    step({ position, quaternion, altitudeKm, timeS, pixelRad }) {
      if (!Number.isFinite(timeS)) {
        throw new RangeError(`the sea's clock must be finite, got ${timeS}`);
      }
      if (sky === null) {
        uniforms.uSeaOn.value = 0;
        return;
      }
      uniforms.uSeaOn.value = on ? globeSeaShareAt(altitudeKm) : 0;
      uniforms.uSeaSkyView.value = sky.atmSkyViewLut.value;
      uniforms.uSeaTransmittance.value = sky.atmTransmittanceLut.value;
      uniforms.uSeaObserverR.value = sky.atmObserverRadius.value;
      uniforms.uSeaRadianceToScene.value = sky.atmRadianceToScene.value;
      uniforms.uSeaPixelRad.value = pixelRad;
      uniforms.uSeaEcefFromView.value.setFromMatrix4(
        rotation.makeRotationFromQuaternion(quaternion),
      );
      windAt(position, wind);
      uniforms.uSeaWind.value.copy(wind);
      if (hasLast) {
        across.copy(position).normalize().cross(wind);
        moved.copy(position).sub(last);
        travel[0] += moved.dot(wind);
        travel[1] += moved.dot(across);
      }
      last.copy(position);
      hasLast = true;
      uniforms.uSeaPhase.value.forEach((phase, octave) => {
        const [x, y] = seaWavePhase(travel, timeS, octave, shortestWaveM);
        phase.set(x, y);
      });
    },
    state: () => ({
      on,
      sky: sky !== null,
      share: uniforms.uSeaOn.value,
      octaves: waveOctaves,
      shortestWaveM,
    }),
  };
}
