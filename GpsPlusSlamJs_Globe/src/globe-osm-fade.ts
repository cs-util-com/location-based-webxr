/**
 * The OpenStreetMap overlay's distance fade and darkening gain, patched
 * into the library's overlay layer blend of every relief material.
 *
 * @see globe-osm-fade.ts.md
 */

/** How the map's gain darkens it (`GLOBE_OSM.gainMode`). */
export type OsmGainMode = "flat" | "compress";

/** The fade's uniforms (shared by every relief material). */
export interface OsmFadeUniforms {
  uOsmFadeM: { value: number };
  uOsmFadeStart: { value: number };
  uOsmOn: { value: number };
  /** The map's darkening gain, in (0, 1] (`GLOBE_OSM.gain`). */
  uOsmGain: { value: number };
  /** 1: the gain multiplies flat; 0: it compresses the luma. */
  uOsmFlat: { value: number };
}

/** The fade's uniforms and the gain's luma compression (GLSL). */
const OSM_FADE_DECLARATIONS = [
  "uniform float uOsmFadeM;",
  "uniform float uOsmFadeStart;",
  "uniform float uOsmOn;",
  "uniform float uOsmGain;",
  "uniform float uOsmFlat;",
  "vec3 osmGain( vec3 c, float g ) {",
  "  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );",
  "  return c * ( g / ( g + ( 1.0 - g ) * l ) );",
  "}",
];

/** The library's overlay blend (0.5.3, `wrapOverlaysMaterial.js`). */
const LAYER_BLEND = "tint.rgba *= layerInfo[ i ].opacity * wOpacity;";

/**
 * Patches the library's overlay layer blend in `shader` to fade every
 * layer out between `uOsmFadeStart x uOsmFadeM` and `uOsmFadeM` from the
 * camera, and to drop it with `uOsmOn` 0. Before the blend it darkens the
 * layer's colour by `uOsmGain`: with `uOsmFlat` 1 a flat multiply (every
 * contrast in the map kept), else compressing its luma L (Rec. 709
 * weights) to L g / (g + (1 - g) L): white ends at g, a dark line keeps
 * nearly its luma, the hue stays, and the map's contrasts are lowered.
 * With the sea compiled it records how much map a pixel shows, so the sea
 * stays under it. Adds the uniforms. False, the shader untouched, where the blend line is
 * missing (a library change).
 */
export function patchOsmFade(
  shader: { uniforms: Record<string, unknown>; fragmentShader: string },
  uniforms: OsmFadeUniforms,
): boolean {
  if (!shader.fragmentShader.includes(LAYER_BLEND)) return false;
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      ["#include <common>", ...OSM_FADE_DECLARATIONS].join("\n"),
    )
    .replaceAll(
      LAYER_BLEND,
      "tint.rgb = uOsmFlat > 0.5 ? tint.rgb * uOsmGain : osmGain( tint.rgb, uOsmGain );\n" +
        "tint.rgba *= layerInfo[ i ].opacity * wOpacity * uOsmOn * ( 1.0 - smoothstep( uOsmFadeStart * uOsmFadeM, uOsmFadeM, length( vViewPosition ) ) );\n" +
        "#ifdef GLOBE_SEA\nglobeMapShare = max( globeMapShare, tint.a );\n#endif",
    );
  return true;
}
