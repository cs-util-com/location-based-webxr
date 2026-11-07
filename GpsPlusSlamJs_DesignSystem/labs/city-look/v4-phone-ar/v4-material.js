/**
 * V4's one building material: Lambert plus a few lines of fragment work reading
 * `aFacade`. Everything is in the material, so it runs wherever the buildings
 * run, WebXR included: no pass, no extra draw, no per-frame CPU work.
 *
 * @see v4-material.js.md
 */

const VERTEX_HEAD = /* glsl */ `
attribute vec4 aFacade;
varying vec4 vFacade;
`;

const FRAGMENT_HEAD = /* glsl */ `
varying vec4 vFacade;
uniform vec2 uFoot;
uniform float uLine;
uniform float uWindow;
uniform float uEave;
const vec2 PANE = vec2(0.21, 0.235);
`;

/**
 * x metres above the ground, y metres per storey (0: none), z the bay
 * coordinate, w the wall's top (0: a roof, untouched). The colour is changed
 * before lighting, so the darkening holds in full sun too: it is a wall
 * weathered at its foot, not a light effect.
 */
const FRAGMENT_FACADE = /* glsl */ `
if (vFacade.w > 0.0) {
  float h = vFacade.x;
  float storey = vFacade.y;
  float metresPerPixel = fwidth(h);
  float near = 1.0 - smoothstep(0.2, 0.7, metresPerPixel);

  float foot = clamp(1.0 - h / uFoot.y, 0.0, 1.0);
  float shade = 1.0 - uFoot.x * foot * foot;

  float underEave = clamp(1.0 - (vFacade.w - h) / 0.7, 0.0, 1.0);
  shade *= 1.0 - uEave * underEave * underEave;

  if (storey > 0.0 && near > 0.0) {
    float s = h / storey;
    float level = floor(s + 0.5);
    float d = (s - level) * storey;
    float aa = max(metresPerPixel, 0.01);
    float inside = step(0.5, level) * step(level * storey + 0.5, vFacade.w);
    float under = smoothstep(-0.2 - aa, -0.2 + aa, d)
      * (1.0 - smoothstep(-aa, aa, d));
    float over = smoothstep(-aa, aa, d)
      * (1.0 - smoothstep(0.07 - aa, 0.07 + aa, d));
    shade *= 1.0 + uLine * near * inside * (0.35 * over - under);

    float storeyFits = step((floor(s) + 1.0) * storey, vFacade.w + 0.3);
    vec2 pane = abs(vec2(fract(vFacade.z) - 0.5, fract(s) - 0.56));
    vec2 paneAa = max(fwidth(vec2(vFacade.z, s)), 0.002);
    vec2 inPane = 1.0 - smoothstep(PANE - paneAa, PANE + paneAa, pane);
    float mullion = smoothstep(0.012, 0.012 + paneAa.x, pane.x);
    float glass = inPane.x * inPane.y * storeyFits * mix(1.0, mullion, near);
    float sill = inPane.x * storeyFits * uWindow * near
      * (1.0 - smoothstep(0.012, 0.012 + paneAa.y, abs(fract(s) - 0.56 + PANE.y + 0.012)));
    shade *= 1.0 + 0.16 * sill;
    diffuseColor.rgb = mix(
      diffuseColor.rgb,
      vec3(0.05, 0.07, 0.095),
      glass * uWindow * near
    );
  }
  diffuseColor.rgb *= shade;
}
`;

/**
 * `{ material, uniforms }`. `look` carries `footStrength`, `footHeightM`,
 * `lineStrength`, `windowStrength`, `eaveStrength`; a uniform change needs no
 * recompile, so the page's controls stay cheap. One material for every chunk.
 */
export function facadeMaterial(THREE, look) {
  const uniforms = {
    uFoot: { value: new THREE.Vector2(look.footStrength, look.footHeightM) },
    uLine: { value: look.lineStrength },
    uWindow: { value: look.windowStrength },
    uEave: { value: look.eaveStrength },
  };
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFacade = aFacade;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${FRAGMENT_FACADE}`,
      );
  };
  material.customProgramCacheKey = () => "city-look-v4-facade";
  return { material, uniforms };
}
