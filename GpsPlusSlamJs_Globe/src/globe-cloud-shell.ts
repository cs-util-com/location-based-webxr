/**
 * The clouds on their own shell above the ground (round-6 plan
 * 2026-10-04-1050 G6-2, DEC-G6-3): the Earth's ellipsoid raised by a height
 * on every axis, drawn after the ground with the clouds as its alpha. Its
 * colour is the surface's cloud shade (`GLOBE_CLOUD_GLSL`), lit by the same
 * sun through the same physical shader, with the same drift, opacity, grade
 * and twilight (`GLOBE_TWILIGHT_GLSL`), so from orbit it reads as the clouds
 * painted into the ground did; up close it floats above the relief instead
 * of re-colouring it.
 *
 * @see globe-cloud-shell.ts.md
 */
import * as THREE from "three";

import {
  GLOBE_CLOUD_GLSL,
  GLOBE_TWILIGHT_GLSL,
  type GlobeSurfaceUniforms,
  afterChunk,
} from "./globe-surface-material.js";

/** The shell's program key (its shader differs from every tile's). */
const PROGRAM_KEY = "gps-plus-slam-globe-cloud-shell-v1";

/**
 * Segments around and from pole to pole: at 256 x 128 a facet's chord sags
 * about 480 m below the sphere, a twentieth of a 9 km shell's height.
 */
const SEGMENTS = Object.freeze({ width: 256, height: 128 });

export interface GlobeCloudShell {
  /** Add to the group the tiles' ECEF frame is placed in. */
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  /**
   * The shell's height above the ellipsoid (m); also the ground's shadow
   * offset (`uCloudShellM`). RangeError unless finite and >= 0.
   */
  setHeightM(heightM: number): void;
  heightM(): number;
  /**
   * How much of the clouds the shell draws, 0-1 (its alpha's factor); the
   * rest the surface paints. Hidden at 0. RangeError outside 0-1.
   */
  setShare(share: number): void;
  share(): number;
  dispose(): void;
}

const VERTEX_DECLARATIONS = /* glsl */ `
uniform vec3 uShellRadii;
varying vec3 vGeoNormal;`;

/** The ellipsoid point is position * radii; its normal is position / radii. */
const VERTEX_NORMAL = /* glsl */ `
vGeoNormal = normalize( position / uShellRadii );`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 uSunEcef;
uniform vec3 uSunWorld;
uniform sampler2D uClouds;
uniform float uCloudOpacity;
uniform float uCloudLonOffset;
uniform float uCloudRelief;
uniform float uGrade;
uniform float uTwilight;
uniform float uShellShare;
varying vec3 vGeoNormal;`;

/** In place of the map: the cloud shade, the cloud as alpha, the grade. */
const FRAGMENT_CLOUD = /* glsl */ `
${GLOBE_CLOUD_GLSL}
diffuseColor = vec4( mix( vec3( 1.0 ), globeCloudShade, uCloudRelief ), globeCloud * uCloudOpacity * uShellShare );
float globeLuma = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, globeLuma * vec3( 0.7, 0.88, 1.2 ), uGrade * 0.7 );`;

const FRAGMENT_TWILIGHT = /* glsl */ `
float globeNdl = dot( globeN, uSunEcef );
${GLOBE_TWILIGHT_GLSL}`;

/**
 * The shell over an ellipsoid of `radii` (ECEF metres, [x, y, z]; WGS84 is
 * [a, a, b]), reading the surface's `uniforms`. Hidden until the page shows
 * it; at height 0 until set.
 */
export function createGlobeCloudShell(options: {
  uniforms: GlobeSurfaceUniforms;
  radii: readonly [number, number, number];
}): GlobeCloudShell {
  const { uniforms, radii } = options;
  if (!radii.every((r) => r > 0 && Number.isFinite(r))) {
    throw new RangeError(
      `the shell needs three positive radii, got ${radii.join(", ")}`,
    );
  }
  const geometry = new THREE.SphereGeometry(1, SEGMENTS.width, SEGMENTS.height);
  // three's sphere has its poles on y; the ECEF frame's are on z.
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shellRadii = { value: new THREE.Vector3(...radii) };
  const shellShare = { value: 0 };
  material.onBeforeCompile = (shader) => {
    let vs = shader.vertexShader;
    vs = afterChunk(vs, "#include <common>", VERTEX_DECLARATIONS);
    vs = afterChunk(vs, "#include <beginnormal_vertex>", VERTEX_NORMAL);
    let fs = shader.fragmentShader;
    fs = afterChunk(fs, "#include <common>", FRAGMENT_DECLARATIONS);
    fs = afterChunk(fs, "#include <map_fragment>", FRAGMENT_CLOUD);
    fs = afterChunk(fs, "#include <emissivemap_fragment>", FRAGMENT_TWILIGHT);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
    Object.assign(shader.uniforms, {
      uShellRadii: shellRadii,
      uShellShare: shellShare,
      uSunEcef: uniforms.uSunEcef,
      uSunWorld: uniforms.uSunWorld,
      uClouds: uniforms.uClouds,
      uCloudOpacity: uniforms.uCloudOpacity,
      uCloudLonOffset: uniforms.uCloudLonOffset,
      uCloudRelief: uniforms.uCloudRelief,
      uGrade: uniforms.uGrade,
      uTwilight: uniforms.uTwilight,
    });
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "globe-cloud-shell";
  mesh.visible = false;
  // Drawn after the opaque ground (three sorts transparent objects last).
  mesh.renderOrder = 1;
  let height = 0;
  const setHeightM = (heightM: number) => {
    if (!(heightM >= 0 && Number.isFinite(heightM))) {
      throw new RangeError(
        `the shell's height must be finite and >= 0, got ${heightM}`,
      );
    }
    height = heightM;
    shellRadii.value.set(
      radii[0] + heightM,
      radii[1] + heightM,
      radii[2] + heightM,
    );
    mesh.scale.copy(shellRadii.value);
    uniforms.uCloudShellM.value = heightM;
  };
  setHeightM(0);
  return {
    mesh,
    setHeightM,
    heightM: () => height,
    setShare(share: number) {
      if (!(share >= 0 && share <= 1)) {
        throw new RangeError(`the shell's share must be in 0-1, got ${share}`);
      }
      shellShare.value = share;
      mesh.visible = share > 0;
    },
    share: () => shellShare.value,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
