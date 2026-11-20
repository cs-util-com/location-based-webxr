/**
 * Why these tests matter: the map's distance fade and gain are patched
 * into the library's overlay layer blend. If the library changes that
 * line the patch must say so, not draw the map at every distance.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { patchOsmFade } from "./globe-osm-fade.js";

/** The library's overlay blend line (0.5.3), read from its own source. */
const LIBRARY = join(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/3d-tiles-renderer/src/three/plugins/images",
);

describe("patchOsmFade", () => {
  // Why: the fade is patched into the library's layer blend; if the
  // library changes that line the patch must say so, not draw OSM at
  // every distance.
  it("patches the library's own layer blend and declares its uniforms", () => {
    const chunk = readFileSync(
      join(LIBRARY, "overlays/wrapOverlaysMaterial.js"),
      "utf8",
    );
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: `#include <common>\nvoid main() {\n${chunk}\n}`,
    };
    const uniforms = {
      uOsmFadeM: { value: 300 },
      uOsmOn: { value: 1 },
      uOsmFadeStart: { value: 0.7 },
      uOsmGain: { value: 0.55 },
      uOsmFlat: { value: 0 },
    };
    expect(patchOsmFade(shader, uniforms)).toBe(true);
    expect(shader.fragmentShader).toContain("uniform float uOsmFadeM;");
    expect(shader.fragmentShader).toContain("length( vViewPosition )");
    expect(shader.fragmentShader).not.toContain(
      "tint.rgba *= layerInfo[ i ].opacity * wOpacity;",
    );
    expect(shader.uniforms.uOsmFadeM).toBe(uniforms.uOsmFadeM);
  });

  // Why: over water the sea is drawn last, so without the map's own share
  // it would paint over the streets of a harbour.
  it("tells a compiled sea how much map a pixel shows", () => {
    const chunk = "tint.rgba *= layerInfo[ i ].opacity * wOpacity;";
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: `#include <common>\nvoid main() {\n${chunk}\n}`,
    };
    patchOsmFade(shader, {
      uOsmFadeM: { value: 300 },
      uOsmOn: { value: 1 },
      uOsmFadeStart: { value: 0.7 },
      uOsmGain: { value: 0.55 },
      uOsmFlat: { value: 0 },
    });
    const glsl = shader.fragmentShader;
    expect(glsl).toContain("globeMapShare = max( globeMapShare, tint.a );");
    expect(glsl.indexOf("#ifdef GLOBE_SEA")).toBeGreaterThan(
      glsl.indexOf("uOsmOn * ("),
    );
  });

  // Why: the street map's tiles are far brighter than the relief's
  // imagery, so the fade's edge showed as a pale disc. The gain darkens the
  // map before it is blended: it compresses the map's luma toward the gain
  // (a white road ends at the gain, a dark one stays nearly as it is), not
  // a flat multiply that would turn its dark lines black as well. Read from
  // the shader the library compiles: the gain is a uniform, applied to the
  // tile's colour before the blend weighs it.
  it("darkens the map by its gain before the blend, compressing its luma", () => {
    const chunk = readFileSync(
      join(LIBRARY, "overlays/wrapOverlaysMaterial.js"),
      "utf8",
    );
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: `#include <common>\nvoid main() {\n${chunk}\n}`,
    };
    const uniforms = {
      uOsmFadeM: { value: 300 },
      uOsmOn: { value: 1 },
      uOsmFadeStart: { value: 0.7 },
      uOsmGain: { value: 0.55 },
      uOsmFlat: { value: 0 },
    };
    expect(patchOsmFade(shader, uniforms)).toBe(true);
    const glsl = shader.fragmentShader;
    expect(glsl).toContain("uniform float uOsmGain;");
    expect(shader.uniforms.uOsmGain).toBe(uniforms.uOsmGain);
    // Luma by its Rec. 709 weights, compressed toward the gain:
    // L' = L g / (g + (1 - g) L), the colour scaled by L' / L.
    expect(glsl).toContain("vec3( 0.2126, 0.7152, 0.0722 )");
    expect(glsl).toContain("g / ( g + ( 1.0 - g ) * l )");
    const gained = glsl.indexOf(": osmGain( tint.rgb, uOsmGain );");
    const blended = glsl.indexOf("tint.rgba *= layerInfo[ i ].opacity");
    expect(gained).toBeGreaterThan(-1);
    expect(blended).toBeGreaterThan(gained);
  });

  // Why: a flat multiply keeps the map's own contrasts (a road against
  // the land, a name against it) where the luma compression lowers them;
  // `uOsmFlat` 1 picks the multiply, 0 the compression, in one shader.
  it("multiplies the map flat by its gain where uOsmFlat is 1", () => {
    const shader = {
      uniforms: {} as Record<string, unknown>,
      fragmentShader: `#include <common>
void main() {
${readFileSync(join(LIBRARY, "overlays/wrapOverlaysMaterial.js"), "utf8")}
}`,
    };
    const uniforms = {
      uOsmFadeM: { value: 300 },
      uOsmOn: { value: 1 },
      uOsmFadeStart: { value: 0.7 },
      uOsmGain: { value: 0.55 },
      uOsmFlat: { value: 1 },
    };
    expect(patchOsmFade(shader, uniforms)).toBe(true);
    expect(shader.fragmentShader).toContain("uniform float uOsmFlat;");
    expect(shader.uniforms.uOsmFlat).toBe(uniforms.uOsmFlat);
    expect(shader.fragmentShader).toContain(
      "tint.rgb = uOsmFlat > 0.5 ? tint.rgb * uOsmGain : osmGain( tint.rgb, uOsmGain );",
    );
  });

  it("reports a shader without the blend line, untouched", () => {
    const shader = { uniforms: {}, fragmentShader: "void main() {}" };
    expect(
      patchOsmFade(shader, {
        uOsmFadeM: { value: 1 },
        uOsmOn: { value: 1 },
        uOsmFadeStart: { value: 0.7 },
        uOsmGain: { value: 1 },
        uOsmFlat: { value: 0 },
      }),
    ).toBe(false);
    expect(shader.fragmentShader).toBe("void main() {}");
  });
});
