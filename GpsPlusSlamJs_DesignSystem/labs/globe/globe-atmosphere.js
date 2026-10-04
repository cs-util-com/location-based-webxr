/**
 * The globe's atmosphere seen from space (round-4 plan 2026-09-28-2105
 * DEC-GL4-4): the lit limb's bright band just inside the Earth's edge, the
 * soft blue halo a little way out into space, and the blue veil over the
 * day side, all from ONE ray march through the framework's physical
 * atmosphere. It reuses the framework's transmittance and multi-scattering
 * tables (which depend on neither the camera nor the sun), so nothing here
 * is tuned per effect: the rim is brightest where the sun shines and fades
 * across the terminator because the tables say so.
 *
 * A full-screen pass drawn after the Earth: each pixel's ray is intersected
 * with the atmosphere's top and the ground analytically (in a frame where
 * the WGS84 ellipsoid is the model's ground sphere), marched in `steps`
 * samples packed towards the ray's densest point, and blended as the
 * in-scattered light plus what lies behind dimmed by the ray's
 * transmittance. Rays that miss the atmosphere are discarded at once.
 *
 * @see globe-atmosphere.js.md
 */
import * as THREE from "three";

import {
  ATMOSPHERE_COMMON_GLSL,
  ATMOSPHERE_RADIANCE_SCALE,
} from "/fw/visualization/atmosphere/atmosphere-glsl.js";
import { WebGlAtmosphereDevice } from "/fw/visualization/atmosphere/atmosphere-luts.js";
import {
  EARTH_ATMOSPHERE,
  mieExtinctionForVisibility,
} from "/fw/visualization/atmosphere/atmosphere-model.js";

import {
  CHAPMAN_GLSL,
  GLOBE_ATMOSPHERE,
  atmosphereLook,
  ellipsoidToModel,
} from "./globe-atmosphere-frame.js";

/**
 * A full-screen triangle; each corner's ray direction in the model frame
 * (`uViewToModel`: the camera's rotation, the world to ECEF, ECEF to the
 * model's axes). Points of the far plane are affine in NDC, so the
 * interpolated direction is exact up to its length.
 */
const VERTEX = /* glsl */ `
uniform mat4 uInverseProjection;
uniform mat3 uViewToModel;
varying vec3 vDirection;
void main() {
  vec4 view = uInverseProjection * vec4( position.xy, 1.0, 1.0 );
  vDirection = uViewToModel * ( view.xyz / view.w );
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/**
 * The march. The ray's parameter t runs from where it enters the air to
 * where it leaves it or meets the ground; the samples are packed
 * quadratically towards t*, the ray's point nearest the centre clamped into
 * that span, from both sides, so the thin dense layer at the limb is not
 * stepped over (for a ray to the ground t* is the ground end).
 *
 * `uThickness` k draws the shell k times thicker: a sample at altitude h
 * reads the air at h / k and its step counts 1 / k, which keeps a
 * VERTICAL ray's optical depth. A grazing ray's does not keep: through an
 * exponential layer of scale height H it is about n0 H Ch(R / H, mu), with
 * Chapman's function Ch(x, mu) about sqrt(pi x / 2) at mu = 0 and 1 / mu
 * for a steep ray, so at the limb a k times thicker shell holds only
 * 1 / sqrt(k) of it (review B2). Each ray's steps are therefore weighted
 * by `grazingCompensation` (the frame module): Ch(R / H, mu) /
 * Ch(R / (k H), mu), normalised to 1 straight down, with mu the ray's
 * zenith cosine at its LOWEST point in the air (the limb's tangent point,
 * the ground hit, or, from inside the shell, the camera when the ray
 * climbs: review M1). Rayleigh and Mie are weighted each with its own
 * scale height (review m3). About sqrt(k) at the limb, 1 for a vertical
 * ray and at k = 1, so the limb's colour does not change with k
 * (DEC-GL4-11), only its width.
 */
const FRAGMENT = /* glsl */ `
${ATMOSPHERE_COMMON_GLSL}
uniform sampler2D atmTransmittanceLut;
uniform sampler2D atmMultiScatteringLut;
uniform vec3 uCamera;
uniform vec3 uSun;
uniform float uRadiance;
uniform float uThickness;
varying vec3 vDirection;

// Chapman's grazing-incidence function and the compensation (the frame
// module's chapman, grazingCompensation and lowestPointMu).
${CHAPMAN_GLSL}

// One step of the march. wR and wM weight the Rayleigh (with ozone) and
// the Mie parts of the air: 1 / k times each one's grazing compensation.
void atmSpaceSample( vec3 p, float dt, float phaseR, float phaseM,
                     float wR, float wM,
                     inout vec3 radiance, inout vec3 throughput ) {
  float pr = length( p );
  float h = max( 0.0, pr - ATM_GROUND_RADIUS ) / uThickness;
  float r = ATM_GROUND_RADIUS + h;
  float sunCos = dot( p, uSun ) / pr;
  vec3 rs; float ms; vec3 extinction;
  atmMedium( h, rs, ms, extinction );
  vec3 sunT = atmSampleTransmittance( atmTransmittanceLut, r, sunCos );
  vec3 multi = atmSampleMultiScattering( atmMultiScatteringLut, r, sunCos );
  float mieExt = ms / ATM_MIE_ALBEDO;
  vec3 rsW = rs * wR;
  float msW = ms * wM;
  vec3 single = ATM_RADIANCE_SCALE * sunT * ( rsW * phaseR + vec3( msW * phaseM ) );
  vec3 source = single + multi * ( rsW + vec3( msW ) );
  vec3 sigma = max( ( extinction - vec3( mieExt ) ) * wR + vec3( mieExt * wM ), vec3( 1e-9 ) );
  vec3 stepT = exp( -sigma * dt );
  radiance += throughput * ( source - source * stepT ) / sigma;
  throughput *= stepT;
}

void main() {
  vec3 dir = normalize( vDirection );
  vec3 o = uCamera;
  float top = ATM_GROUND_RADIUS + ( ATM_TOP_RADIUS - ATM_GROUND_RADIUS ) * uThickness;
  float b = dot( o, dir );
  float oo = dot( o, o );
  float disc = b * b - ( oo - top * top );
  if ( disc <= 0.0 ) discard;
  float tExit = -b + sqrt( disc );
  if ( tExit <= 0.0 ) discard;
  float tEnter = max( 0.0, -b - sqrt( disc ) );
  float discG = b * b - ( oo - ATM_GROUND_RADIUS * ATM_GROUND_RADIUS );
  float tGround = discG > 0.0 ? -b - sqrt( discG ) : -1.0;
  bool hitsGround = tGround > 0.0;
  float tEnd = hitsGround ? tGround : tExit;
  if ( tEnd <= tEnter ) discard;
  float tMid = clamp( -b, tEnter, tEnd );
  // The grazing compensation (see above), at the ray's lowest point.
  float muRay = atmLowestPointMu( o, dir, tEnter, tEnd );
  float wR = atmGrazingCompensation( uThickness, muRay, ATM_GROUND_RADIUS / ATM_RAYLEIGH_SCALE_HEIGHT ) / uThickness;
  float wM = atmGrazingCompensation( uThickness, muRay, ATM_GROUND_RADIUS / ATM_MIE_SCALE_HEIGHT ) / uThickness;
  float cosTheta = dot( dir, uSun );
  float phaseR = atmRayleighPhase( cosTheta );
  float phaseM = atmMiePhase( cosTheta );
  vec3 radiance = vec3( 0.0 );
  vec3 throughput = vec3( 1.0 );
  const int NEAR = ATM_SPACE_STEPS / 2;
  const int FAR = ATM_SPACE_STEPS - NEAR;
  float lenA = tMid - tEnter;
  for ( int k = 0; k < NEAR; k++ ) {
    float u0 = 1.0 - float( k ) / float( NEAR );
    float u1 = 1.0 - float( k + 1 ) / float( NEAR );
    float um = 1.0 - ( float( k ) + 0.5 ) / float( NEAR );
    atmSpaceSample( o + dir * ( tMid - um * um * lenA ),
                    ( u0 * u0 - u1 * u1 ) * lenA, phaseR, phaseM, wR, wM, radiance, throughput );
  }
  float lenB = tEnd - tMid;
  for ( int k = 0; k < FAR; k++ ) {
    float u0 = float( k ) / float( FAR );
    float u1 = float( k + 1 ) / float( FAR );
    float um = ( float( k ) + 0.5 ) / float( FAR );
    atmSpaceSample( o + dir * ( tMid + um * um * lenB ),
                    ( u1 * u1 - u0 * u0 ) * lenB, phaseR, phaseM, wR, wM, radiance, throughput );
  }
  // The in-scattered light, and the share of the ground behind it that
  // comes through: one grey value, the mean over R, G, B (a per-channel
  // veil needs the ground's own shader). Space behind keeps its stars.
  float through = hitsGround ? dot( throughput, vec3( 1.0 / 3.0 ) ) : 1.0;
  gl_FragColor = vec4( radiance * uRadiance, 1.0 - through );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The atmosphere pass for a renderer. The two tables are built on the
 * first draw (they depend on neither the camera nor the sun).
 * `ellipsoidRadii` are the globe ellipsoid's radii in metres.
 */
export function createGlobeAtmosphere(renderer, ellipsoidRadii) {
  const device = new WebGlAtmosphereDevice(renderer);
  const toModel = ellipsoidToModel(
    ellipsoidRadii,
    EARTH_ATMOSPHERE.groundRadiusKm,
  );
  const scaleToModel = new THREE.Matrix3().set(
    ...[toModel[0], 0, 0, 0, toModel[1], 0, 0, 0, toModel[2]],
  );
  let look = atmosphereLook({});
  const uniforms = {
    atmMieExtinction: {
      value: mieExtinctionForVisibility(GLOBE_ATMOSPHERE.visibilityKm),
    },
    atmTransmittanceLut: { value: device.transmittance },
    atmMultiScatteringLut: { value: device.multiScattering },
    atmSkyViewLut: { value: device.skyView },
    atmSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    atmSunCosZenith: { value: 1 },
    atmObserverRadius: { value: EARTH_ATMOSPHERE.groundRadiusKm },
    atmRadianceToScene: { value: 1 },
    uInverseProjection: { value: new THREE.Matrix4() },
    uViewToModel: { value: new THREE.Matrix3() },
    uCamera: { value: new THREE.Vector3() },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uRadiance: { value: 0 },
    uThickness: { value: look.thickness },
  };
  let built = false;
  const material = new THREE.ShaderMaterial({
    defines: { ATM_SPACE_STEPS: look.steps },
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // Premultiplied: the light added, what lies behind times (1 - alpha);
    // the canvas's own alpha kept.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const triangle = new THREE.Mesh(geometry, material);
  triangle.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(triangle);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const ecefFromWorld = new THREE.Matrix4();
  const rotation = new THREE.Matrix3();
  const cameraEcef = new THREE.Vector3();
  return {
    /** False where float colour buffers cannot be rendered: no pass. */
    get supported() {
      return device.supported;
    },
    get look() {
      return { ...look };
    },
    /** Sets any of steps, strength, thickness; RangeError as atmosphereLook. */
    setLook(input) {
      look = atmosphereLook({ ...look, ...input });
      uniforms.uThickness.value = look.thickness;
      if (material.defines.ATM_SPACE_STEPS !== look.steps) {
        material.defines.ATM_SPACE_STEPS = look.steps;
        material.needsUpdate = true;
      }
    },
    /**
     * Draws the pass over the current frame. `camera` is the globe's
     * (updated world matrix), `worldFromEcef` the tiles group's world
     * matrix (the ECEF frame's placement), `sunEcef` a unit vector and
     * `sunIntensity` the Earth's sun light's, so the air and the ground are
     * lit by the same sun.
     */
    render(camera, { worldFromEcef, sunEcef, sunIntensity }) {
      if (!device.supported) return;
      if (!built) {
        device.render("transmittance", uniforms);
        device.render("multiScattering", uniforms);
        built = true;
      }
      ecefFromWorld.copy(worldFromEcef).invert();
      uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
      uniforms.uViewToModel.value
        .copy(scaleToModel)
        .multiply(rotation.setFromMatrix4(ecefFromWorld))
        .multiply(rotation.setFromMatrix4(camera.matrixWorld));
      cameraEcef.setFromMatrixPosition(camera.matrixWorld);
      cameraEcef.applyMatrix4(ecefFromWorld);
      uniforms.uCamera.value.set(
        cameraEcef.x * toModel[0],
        cameraEcef.y * toModel[1],
        cameraEcef.z * toModel[2],
      );
      uniforms.uSun.value
        .set(
          sunEcef.x * toModel[0],
          sunEcef.y * toModel[1],
          sunEcef.z * toModel[2],
        )
        .normalize();
      // The tables hold radiance for a sun of ATMOSPHERE_RADIANCE_SCALE:
      // per unit of that, times the scene's sun and the look's strength.
      uniforms.uRadiance.value =
        (sunIntensity * look.strength) / ATMOSPHERE_RADIANCE_SCALE;
      renderer.render(scene, quadCamera);
    },
    dispose() {
      device.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
