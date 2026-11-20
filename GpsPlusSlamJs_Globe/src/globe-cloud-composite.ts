/**
 * The cloud composite: ONE full-screen mix over the frame of the
 * spherical shell's target and the slab's, premultiplied and weighted,
 * with the shell's ground shadow under both and the high layer over or
 * under them by its height. Moved out of the shell volume pass
 * (`globe-cloud-shell-volume-pass.ts`), which owns the targets and draws
 * this material on its full-screen triangle.
 *
 * @see globe-cloud-composite.ts.md
 */
import * as THREE from "three";

const COMPOSITE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/**
 * The mix: the shell and the slab premultiplied, each by its weight, never
 * one over the other; then straight colour, three's tone mapping and colour
 * space, and the alpha blended over the frame (the slab's own composite).
 */
const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tShell;
uniform sampler2D tSlab;
uniform float uShellWeight;
uniform float uSlabWeight;
// The shell's ground shadow, drawn on its own.
uniform sampler2D tShadow;
uniform float uShadowOn;
// The high layer: on, and in front (from above).
uniform sampler2D tHigh;
uniform float uHighOn;
uniform float uHighInFront;
varying vec2 vUv;
void main() {
  vec4 shell = texture2D( tShell, vUv );
  vec4 c = uShellWeight * shell;
  if ( uSlabWeight > 0.0 ) {
    // Per pixel: the shell gives up the slab's share only of the cloud the
    // slab draws here, r = the slab's alpha over the shell's (1 where the
    // shell draws none), so where the slab draws less (its fade ring,
    // beyond its disc, a clear patch) the shell fills it. Twin:
    // cloudShellPixelWeight.
    vec4 slab = texture2D( tSlab, vUv );
    float r = shell.a > 1e-4 ? min( 1.0, slab.a / shell.a ) : 1.0;
    c = uShellWeight * ( 1.0 - uSlabWeight * r ) * shell + uSlabWeight * slab;
  }
  // The ground shadow under both clouds: in the shell's own alpha the
  // slab's per-pixel share took it with the shell's clouds, and below the
  // slab's ceiling the ground lost its shadows (an 0.12 share of shadowed
  // points in the target, none on the screen at 5 km, measured). Black,
  // under the mix.
  if ( uShadowOn > 0.5 ) {
    c.a = min( c.a, 1.0 );
    c.a += ( 1.0 - c.a ) * texture2D( tShadow, vUv ).a;
  }
  if ( uHighOn > 0.5 ) {
    // Premultiplied over (twin of cloudLayerOver), its order by height.
    vec4 high = texture2D( tHigh, vUv );
    c.a = min( c.a, 1.0 );
    c = uHighInFront > 0.5 ? high + ( 1.0 - high.a ) * c : c + ( 1.0 - c.a ) * high;
  }
  if ( c.a < 1e-4 ) discard;
  gl_FragColor = vec4( c.rgb / c.a, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = min( c.a, 1.0 );
}`;

/** The shell pass's targets the composite reads. */
export interface GlobeCloudCompositeTextures {
  /** The shell's march. */
  shell: THREE.Texture;
  /** The shell's ground shadow, alone. */
  shadow: THREE.Texture;
  /** The high layer's march. */
  high: THREE.Texture;
}

/** What one draw of the composite weighs. */
export interface GlobeCloudCompositeFrame {
  /** The shell's own fade-in (0 to 1). */
  shellIn: number;
  /** The shell's ground shadow's strength (0: none drawn). */
  shadowStrength: number;
  /** The high layer drawn this frame, or null. */
  high: { altitudeKm: number } | null;
  /** The camera's height (km). */
  cameraKm: number;
  /** The slab drawn this frame at its full share, or null. */
  slabTexture: THREE.Texture | null;
  /** The slab's share. */
  slabWeight: number;
}

export interface GlobeCloudComposite {
  /** The mix's material, for the caller's full-screen triangle. */
  readonly material: THREE.ShaderMaterial;
  /** The frame's switches and weights into the material. */
  apply(frame: GlobeCloudCompositeFrame): void;
  dispose(): void;
}

/** The composite of the shell pass's `textures` and a slab texture. */
export function createGlobeCloudComposite(
  textures: GlobeCloudCompositeTextures,
): GlobeCloudComposite {
  const compositeUniforms = {
    tShell: { value: textures.shell },
    tShadow: { value: textures.shadow },
    uShadowOn: { value: 0 },
    tSlab: { value: null as THREE.Texture | null },
    uShellWeight: { value: 0 },
    uSlabWeight: { value: 0 },
    tHigh: { value: textures.high },
    uHighOn: { value: 0 },
    uHighInFront: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: compositeUniforms,
    vertexShader: COMPOSITE_VERTEX,
    fragmentShader: COMPOSITE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });

  /** The composite's switches for the shell's own layers. */
  const applyShellSwitches = ({
    shellIn,
    shadowStrength,
    high,
    cameraKm,
  }: GlobeCloudCompositeFrame) => {
    // The high layer at full strength wherever the shell draws (not handed
    // to the slab), in front of the clouds from above its middle and
    // behind them from below (premultiplied over, cloudLayerOver).
    compositeUniforms.uHighOn.value = high !== null && shellIn > 0 ? 1 : 0;
    compositeUniforms.uShadowOn.value =
      shadowStrength > 0 && shellIn > 0 ? 1 : 0;
    compositeUniforms.uHighInFront.value =
      high !== null && cameraKm > high.altitudeKm ? 1 : 0;
    // The shell's own fade-in; the composite weighs it per pixel by what
    // the slab draws (`cloudShellPixelWeight`).
    compositeUniforms.uShellWeight.value = shellIn;
  };

  return {
    material,
    apply(frame) {
      applyShellSwitches(frame);
      compositeUniforms.tSlab.value = frame.slabTexture;
      compositeUniforms.uSlabWeight.value =
        frame.slabTexture === null ? 0 : frame.slabWeight;
    },
    dispose() {
      material.dispose();
    },
  };
}
