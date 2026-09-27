/**
 * The sky behind the globe (round-2 plan 2026-09-26-2055 M3e): the sun as a
 * disc with a soft glow, drawn in a BACKGROUND pass before the Earth. The
 * pass has its own camera, which shares only the view's rotation and field
 * of view, so no far plane of the globe's camera can clip the sky, and the
 * sky neither tests nor writes depth, so the Earth, drawn after it, covers
 * it by draw order. The same pass draws the stars (M3d), PROCEDURAL ones
 * (`globe-stars.ts`: no catalogue with a clear licence was found, owner
 * decision on round-2 Q2), and a faint Milky Way band along the galactic
 * plane, both turned into ECEF by the caller's celestial rotation.
 *
 * @see globe-sky.ts.md
 */
import * as THREE from "three";

import {
  GALACTIC_CENTRE,
  GALACTIC_NORTH_POLE,
  GLOBE_STARS,
  generateStarField,
} from "./globe-stars.js";

export const GLOBE_SKY = {
  /** The sky sphere's radius around the sky camera (units are arbitrary). */
  radius: 1,
  /** The real sun's mean apparent diameter, 0.533° (32 arc minutes). */
  sunDiameterDeg: 0.533,
  /**
   * The disc's radiance: far above 1, so tone mapping draws it white
   * whatever the exposure, as a camera sees the sun.
   */
  sunRadiance: 40,
  /**
   * The glow's strength at the disc's edge and its angular width (radians):
   * it falls to 1/e this far outside the disc. A look, not physics: space
   * has no air to scatter it; a lens and an eye do.
   */
  glow: 1,
  glowWidthRad: 1.5 * (Math.PI / 180),
  /** The faintest stars drawn by default: the naked-eye limit. */
  starMagLimit: 6.5,
  /**
   * The stars' brightness: a star of magnitude m has the linear radiance
   * gain x 10^(-0.2 (m + 1)), so magnitude -1 reads 1 and magnitude 6.5
   * about 0.03, which the sRGB output shows at about 49/255 (the eye's
   * compressed response; the physical 10^(-0.4 m) would leave only a few
   * dozen visible). The pass is not tone mapped, so these reach the screen.
   */
  starGain: 1,
  /**
   * The Milky Way band's peak linear radiance: faint, about 38/255 on
   * screen towards the galactic centre and half that across the sky.
   */
  milkyWay: 0.02,
  /** The band's half width (radians): about 10° either side of the plane. */
  milkyWayWidthRad: 10 * (Math.PI / 180),
  /** The stars sit inside the sky sphere, at this fraction of its radius. */
  starShell: 0.9,
} as const;

/** The sky pass's uniforms. */
interface GlobeSkyUniforms {
  /** Unit direction towards the sun, in the view camera's world frame. */
  readonly uSunDirection: { value: THREE.Vector3 };
  /** The disc's angular radius, radians. */
  readonly uSunRadius: { value: number };
  readonly uSunRadiance: { value: number };
  readonly uGlow: { value: number };
  readonly uGlowWidth: { value: number };
  /** The galactic pole and centre, in the view's world frame (unit). */
  readonly uGalPole: { value: THREE.Vector3 };
  readonly uGalCentre: { value: THREE.Vector3 };
  readonly uMilkyWay: { value: number };
  readonly uMilkyWayWidth: { value: number };
}

/** The star points' uniforms. */
interface GlobeStarUniforms {
  readonly uMagLimit: { value: number };
  readonly uStarGain: { value: number };
  /** Device pixels per CSS pixel, so a star keeps its size on a phone. */
  readonly uPixelRatio: { value: number };
}

export interface GlobeSky {
  /** What the sky pass draws; render it with `camera`, before the Earth. */
  readonly scene: THREE.Scene;
  /** The sky pass's camera: at the origin, the view's rotation and fov. */
  readonly camera: THREE.PerspectiveCamera;
  readonly uniforms: GlobeSkyUniforms;
  /** The procedural stars (generated to GLOBE_STARS.maxMagLimit). */
  readonly stars: THREE.Points;
  readonly starUniforms: GlobeStarUniforms;
  /** How many stars the current magnitude limit draws. */
  visibleStars(): number;
  /**
   * Turns the stars and the Milky Way from the celestial frame into the
   * view's world frame (ECEF turned by the globe's placement; the lab
   * builds it from Greenwich sidereal time).
   */
  setCelestialRotation(rotation: THREE.Quaternion): void;
  /**
   * The stars' look: the magnitude limit (0.5-7.5), the gain (>= 0), the
   * Milky Way's radiance (>= 0), the device pixel ratio (> 0), and whether
   * the stars are drawn. RangeError otherwise.
   */
  setStarLook(look: {
    magLimit: number;
    gain: number;
    milkyWay: number;
    pixelRatio: number;
    visible: boolean;
  }): void;
  /**
   * Points the sun (world frame, any length); the same direction that
   * lights the Earth. RangeError for a zero or non-finite vector.
   */
  setSun(direction: THREE.Vector3): void;
  /**
   * The lab's look: the disc's apparent diameter in degrees (> 0) and the
   * glow's strength (>= 0). RangeError otherwise.
   */
  setLook(look: { sunDiameterDeg: number; glow: number }): void;
  /** Copies the view's world rotation, fov, aspect and zoom (never more). */
  syncCamera(view: THREE.PerspectiveCamera): void;
  /** Syncs the camera to `view` and draws the sky (the caller clears first). */
  render(renderer: THREE.WebGLRenderer, view: THREE.PerspectiveCamera): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

/**
 * The angle to the sun from the chord between the two unit vectors,
 * 2 asin(|d - s| / 2): exact near zero, where acos(dot) loses the 0.27°
 * disc to 32-bit rounding. The disc's edge is smoothed over one pixel
 * (fwidth), the glow falls off exponentially outside it.
 */
const FRAGMENT = /* glsl */ `
uniform vec3 uSunDirection;
uniform float uSunRadius;
uniform float uSunRadiance;
uniform float uGlow;
uniform float uGlowWidth;
uniform vec3 uGalPole;
uniform vec3 uGalCentre;
uniform float uMilkyWay;
uniform float uMilkyWayWidth;
varying vec3 vDirection;
void main() {
  vec3 d = normalize( vDirection );
  float angle = 2.0 * asin( clamp( 0.5 * length( d - uSunDirection ), 0.0, 1.0 ) );
  float edge = max( fwidth( angle ), 1e-6 );
  float disc = 1.0 - smoothstep( uSunRadius - edge, uSunRadius + edge, angle );
  float glow = uGlow * exp( -max( angle - uSunRadius, 0.0 ) / uGlowWidth );
  vec3 sunColor = vec3( 1.0, 0.96, 0.9 );
  // The Milky Way: a band along the galactic plane, brighter towards the
  // galactic centre, mottled in GALACTIC longitude and latitude (so the
  // pattern turns with the band; whole-number wave counts keep it seamless
  // across the longitude's wrap).
  vec3 galEast = normalize( cross( uGalPole, uGalCentre ) );
  float galLat = asin( clamp( dot( d, uGalPole ), -1.0, 1.0 ) );
  float galLon = atan( dot( d, galEast ), dot( d, uGalCentre ) );
  float b = galLat / uMilkyWayWidth;
  float towards = 0.35 + 0.65 * max( dot( d, uGalCentre ), 0.0 );
  float mottle = 0.7 + 0.3 * sin( 7.0 * galLon + 1.3 ) * sin( 11.0 * galLon + 19.0 * galLat );
  vec3 milky = vec3( 0.85, 0.88, 1.0 ) * uMilkyWay * exp( -b * b ) * towards * mottle;
  // Not tone mapped (the faint band and stars would be crushed): the disc
  // is clamped here instead, white as a camera sees the sun.
  vec3 sky = sunColor * ( disc * uSunRadiance + ( 1.0 - disc ) * glow ) + milky;
  gl_FragColor = vec4( min( sky, vec3( 1.0 ) ), 1.0 );
  #include <colorspace_fragment>
}`;

/**
 * A star as a round, soft point: brightness 10^(-0.2 (m + 1)) x gain (the
 * eye's compressed response), bigger when brighter. A star past the limit
 * is moved outside the clip volume and blacked out: a point size of 0 is
 * undefined in WebGL, and ANGLE draws it as one pixel.
 */
const STAR_VERTEX = /* glsl */ `
attribute float aMag;
attribute vec3 aColor;
uniform float uMagLimit;
uniform float uStarGain;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  if ( aMag > uMagLimit ) {
    vColor = vec3( 0.0 );
    gl_PointSize = 1.0;
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  float intensity = uStarGain * pow( 10.0, -0.2 * ( aMag + 1.0 ) );
  vColor = aColor * intensity;
  gl_PointSize = uPixelRatio * ( 1.2 + 1.8 * clamp( intensity, 0.0, 1.0 ) );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const STAR_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  float r = 2.0 * length( gl_PointCoord - 0.5 );
  float a = 1.0 - smoothstep( 0.4, 1.0, r );
  gl_FragColor = vec4( min( vColor * a, vec3( 1.0 ) ), 1.0 );
  #include <colorspace_fragment>
}`;

/** The stars, as points on a shell inside the sky sphere. */
function createStars(uniforms: GlobeStarUniforms): {
  points: THREE.Points;
  magnitudes: Float32Array;
} {
  const field = generateStarField({
    seed: GLOBE_STARS.seed,
    magLimit: GLOBE_STARS.maxMagLimit,
  });
  const positions = field.directions.map(
    (v) => v * GLOBE_SKY.radius * GLOBE_SKY.starShell,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aMag", new THREE.BufferAttribute(field.magnitudes, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(field.colors, 3));
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // After the sky sphere, so the stars add to its black (and its glow).
  points.renderOrder = 1;
  return { points, magnitudes: field.magnitudes };
}

const requireDirection = (v: THREE.Vector3): number => {
  const length = v.length();
  if (!(length > 0 && Number.isFinite(length))) {
    throw new RangeError(
      `sun direction must be finite and non-zero, got ${v.toArray().join(", ")}`,
    );
  }
  return length;
};

/** The sky pass: a sphere around its own camera, drawn inside out. */
export function createGlobeSky(): GlobeSky {
  const uniforms: GlobeSkyUniforms = {
    uSunDirection: { value: new THREE.Vector3(1, 0, 0) },
    uSunRadius: { value: (GLOBE_SKY.sunDiameterDeg / 2) * (Math.PI / 180) },
    uSunRadiance: { value: GLOBE_SKY.sunRadiance },
    uGlow: { value: GLOBE_SKY.glow },
    uGlowWidth: { value: GLOBE_SKY.glowWidthRad },
    uGalPole: { value: new THREE.Vector3(...GALACTIC_NORTH_POLE) },
    uGalCentre: { value: new THREE.Vector3(...GALACTIC_CENTRE) },
    uMilkyWay: { value: GLOBE_SKY.milkyWay },
    uMilkyWayWidth: { value: GLOBE_SKY.milkyWayWidthRad },
  };
  const starUniforms: GlobeStarUniforms = {
    uMagLimit: { value: GLOBE_SKY.starMagLimit },
    uStarGain: { value: GLOBE_SKY.starGain },
    uPixelRatio: { value: 1 },
  };
  const { points: stars, magnitudes } = createStars(starUniforms);
  const galPole = new THREE.Vector3(...GALACTIC_NORTH_POLE);
  const galCentre = new THREE.Vector3(...GALACTIC_CENTRE);
  let visibleStars = magnitudes.filter(
    (m) => m <= GLOBE_SKY.starMagLimit,
  ).length;
  const material = new THREE.ShaderMaterial({
    // The same { value } objects, in the record type three expects.
    uniforms: { ...uniforms },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    // The faint band would be crushed by tone mapping; the shader clamps.
    toneMapped: false,
  });
  const geometry = new THREE.SphereGeometry(GLOBE_SKY.radius, 64, 32);
  const sphere = new THREE.Mesh(geometry, material);
  sphere.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(sphere, stars);
  // Its own planes around the unit sphere: the view's would clip it.
  const camera = new THREE.PerspectiveCamera(
    50,
    1,
    GLOBE_SKY.radius / 10,
    GLOBE_SKY.radius * 10,
  );
  const viewRotation = new THREE.Quaternion();
  const syncCamera = (view: THREE.PerspectiveCamera) => {
    view.getWorldQuaternion(viewRotation);
    camera.quaternion.copy(viewRotation);
    if (
      camera.fov !== view.fov ||
      camera.aspect !== view.aspect ||
      camera.zoom !== view.zoom
    ) {
      camera.fov = view.fov;
      camera.aspect = view.aspect;
      camera.zoom = view.zoom;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
  };
  return {
    scene,
    camera,
    uniforms,
    stars,
    starUniforms,
    visibleStars: () => visibleStars,
    setCelestialRotation(rotation) {
      stars.quaternion.copy(rotation);
      stars.updateMatrixWorld();
      uniforms.uGalPole.value.copy(galPole).applyQuaternion(rotation);
      uniforms.uGalCentre.value.copy(galCentre).applyQuaternion(rotation);
    },
    setStarLook({ magLimit, gain, milkyWay, pixelRatio, visible }) {
      if (!(magLimit >= 0.5 && magLimit <= GLOBE_STARS.maxMagLimit)) {
        throw new RangeError(
          `star magnitude limit must be within 0.5-${GLOBE_STARS.maxMagLimit}, got ${magLimit}`,
        );
      }
      for (const [name, value] of [
        ["star gain", gain],
        ["Milky Way", milkyWay],
      ] as const) {
        if (!(value >= 0 && Number.isFinite(value))) {
          throw new RangeError(`${name} must be finite and >= 0, got ${value}`);
        }
      }
      if (!(pixelRatio > 0 && Number.isFinite(pixelRatio))) {
        throw new RangeError(`pixel ratio must be > 0, got ${pixelRatio}`);
      }
      if (starUniforms.uMagLimit.value !== magLimit) {
        visibleStars = magnitudes.filter((m) => m <= magLimit).length;
      }
      starUniforms.uMagLimit.value = magLimit;
      starUniforms.uStarGain.value = gain;
      starUniforms.uPixelRatio.value = pixelRatio;
      uniforms.uMilkyWay.value = milkyWay;
      stars.visible = visible;
    },
    setSun(direction) {
      const length = requireDirection(direction);
      uniforms.uSunDirection.value.copy(direction).divideScalar(length);
    },
    setLook({ sunDiameterDeg, glow }) {
      if (!(sunDiameterDeg > 0 && Number.isFinite(sunDiameterDeg))) {
        throw new RangeError(
          `sun diameter must be a positive number of degrees, got ${sunDiameterDeg}`,
        );
      }
      if (!(glow >= 0 && Number.isFinite(glow))) {
        throw new RangeError(`glow must be finite and >= 0, got ${glow}`);
      }
      uniforms.uSunRadius.value = (sunDiameterDeg / 2) * (Math.PI / 180);
      uniforms.uGlow.value = glow;
    },
    syncCamera,
    render(renderer, view) {
      syncCamera(view);
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
    },
  };
}
