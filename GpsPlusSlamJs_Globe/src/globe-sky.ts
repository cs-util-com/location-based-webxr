/**
 * The sky behind the globe (round-2 plan 2026-09-26-2055 M3e): the sun as a
 * disc with a soft glow, drawn in a BACKGROUND pass before the Earth. The
 * pass has its own camera, which shares only the view's rotation and field
 * of view, so no far plane of the globe's camera can clip the sky, and the
 * sky neither tests nor writes depth, so the Earth, drawn after it, covers
 * it by draw order. The stars (M3d) are meant to join this pass once their
 * catalogue's licence is settled (round-2 plan §6 Q2).
 *
 * @see globe-sky.ts.md
 */
import * as THREE from "three";

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
} as const;

/** The sky pass's uniforms. */
export interface GlobeSkyUniforms {
  /** Unit direction towards the sun, in the view camera's world frame. */
  readonly uSunDirection: { value: THREE.Vector3 };
  /** The disc's angular radius, radians. */
  readonly uSunRadius: { value: number };
  readonly uSunRadiance: { value: number };
  readonly uGlow: { value: number };
  readonly uGlowWidth: { value: number };
}

export interface GlobeSky {
  /** What the sky pass draws; render it with `camera`, before the Earth. */
  readonly scene: THREE.Scene;
  /** The sky pass's camera: at the origin, the view's rotation and fov. */
  readonly camera: THREE.PerspectiveCamera;
  readonly uniforms: GlobeSkyUniforms;
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
varying vec3 vDirection;
void main() {
  vec3 d = normalize( vDirection );
  float angle = 2.0 * asin( clamp( 0.5 * length( d - uSunDirection ), 0.0, 1.0 ) );
  float edge = max( fwidth( angle ), 1e-6 );
  float disc = 1.0 - smoothstep( uSunRadius - edge, uSunRadius + edge, angle );
  float glow = uGlow * exp( -max( angle - uSunRadius, 0.0 ) / uGlowWidth );
  vec3 sunColor = vec3( 1.0, 0.96, 0.9 );
  gl_FragColor = vec4( sunColor * ( disc * uSunRadiance + ( 1.0 - disc ) * glow ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

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
  };
  const material = new THREE.ShaderMaterial({
    // The same { value } objects, in the record type three expects.
    uniforms: { ...uniforms },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const geometry = new THREE.SphereGeometry(GLOBE_SKY.radius, 64, 32);
  const sphere = new THREE.Mesh(geometry, material);
  sphere.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(sphere);
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
    },
  };
}
