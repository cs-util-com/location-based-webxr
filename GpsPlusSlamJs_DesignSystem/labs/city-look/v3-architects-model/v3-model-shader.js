/**
 * The model's materials: one building material whose walls carry storey lines
 * cut in real metres, and the paper treatment of ground, roads and trees. One
 * shader cost per building and nothing per frame on the CPU.
 *
 * @see v3-model-shader.js.md
 */

const VERTEX_HEAD = /* glsl */ `
  attribute vec3 aRoofTint;
  attribute vec2 aFinish;
  attribute vec3 aStorey;
  attribute float aRoofShell;
  attribute vec2 aWallSpan;
  varying vec3 vRoofTint;
  varying vec2 vFinish;
  varying vec3 vStorey;
  varying float vRoofShell;
  varying vec2 vWallSpan;
  varying vec3 vModel;
`;

const VERTEX_BODY = /* glsl */ `
  vRoofTint = aRoofTint;
  vFinish = aFinish;
  vStorey = aStorey;
  vRoofShell = aRoofShell;
  vWallSpan = aWallSpan;
  vModel = position;
`;

const FRAGMENT_HEAD = /* glsl */ `
  uniform float uLineStrength;
  uniform float uLineHalfM;
  uniform float uBayM;
  uniform float uBayDepth;
  uniform float uNeutral;
  uniform float uFill;
  varying vec3 vRoofTint;
  varying vec2 vFinish;
  varying vec3 vStorey;
  varying float vRoofShell;
  varying vec2 vWallSpan;
  varying vec3 vModel;

  /** Coverage of a line of half width halfM at distance dist, filtered. */
  float lineCover(float dist, float halfM, float px) {
    return clamp((halfM + 0.5 * px - dist) / px, 0.0, 1.0)
      * min(1.0, 2.0 * halfM / px);
  }

  /**
   * How much of a wall is cut away, 0 clean to 1 a full groove: the storey
   * lines, a cornice line, and openings spaced to the wall's own length.
   */
  float wallCut(float height, float storeyM, float eaveDrop, vec2 span) {
    float px = max(fwidth(height), 1e-4);
    float pxU = max(fwidth(span.x), 1e-4);
    if (storeyM <= 0.0 || eaveDrop <= 0.0) return 0.0;
    float phase = height / storeyM;
    float dist = abs(fract(phase + 0.5) - 0.5) * storeyM;
    // No line at the foot: a groove at the ground is wall-foot darkening.
    float cut = lineCover(dist, uLineHalfM, px) * step(1.0, height);
    cut = max(cut, lineCover(abs(eaveDrop - 0.38), 0.7 * uLineHalfM, px));
    if (uBayM > 0.0 && span.y >= 0.6 * uBayM) {
      float bay = span.y / max(1.0, floor(span.y / uBayM + 0.5));
      float inBay = abs(fract(span.x / bay) - 0.5) * bay;
      float offset = fract(phase) - 0.56;
      float across = abs(offset) * storeyM;
      float openU = clamp((0.34 * bay - inBay) / pxU + 0.5, 0.0, 1.0);
      float openV = clamp((0.27 * storeyM - across) / px + 0.5, 0.0, 1.0);
      // Openings go before they would alias; the lines take over from there.
      float fade = 1.0 - smoothstep(0.12, 0.35, max(pxU / bay, px / storeyM));
      // The reveal is darkest under the lintel, as a recess would be.
      float recess = mix(0.7, 1.0, clamp(offset / 0.54 + 0.5, 0.0, 1.0));
      float open = openU * openV;
      cut = max(cut, open * uBayDepth * recess * fade);
      // Up close a panel is a poster: an outline and one bar make it an opening.
      float halfU = 0.34 * bay;
      float halfV = 0.27 * storeyM;
      float edgeU = lineCover(abs(inBay - halfU), 0.02, pxU) * openV;
      float edgeV = lineCover(abs(across - halfV), 0.02, px) * openU;
      float bar = lineCover(inBay, 0.015, pxU) * open;
      cut = max(cut, max(max(edgeU, edgeV), bar) * 0.7 * fade);
    }
    return cut;
  }
`;

const COLOUR_CHUNK = /* glsl */ `
  vec3 modelNormal = normalize(cross(dFdx(vModel), dFdy(vModel)));
  float roofness = max(
    vRoofShell,
    smoothstep(0.12, 0.25, abs(modelNormal.y))
  );
  diffuseColor.rgb *= mix(vColor.rgb, vRoofTint, roofness);
  float finish = mix(vFinish.x, vFinish.y, roofness);
  float cut = (1.0 - roofness) * wallCut(
    vModel.y - vStorey.x, vStorey.y, vStorey.z - vModel.y, vWallSpan
  );
  diffuseColor.rgb *= 1.0 - uLineStrength * cut;
`;

/**
 * White card in a blue sky turns blue. A model is lit in a studio, so the
 * sky's fill loses its colour here, on the buildings only; the albedo's tints
 * are untouched because this runs on the light, before it meets the surface.
 */
const FILL_CHUNK = /* glsl */ `
  #if defined( RE_IndirectDiffuse )
    irradiance = uFill * mix(
      irradiance,
      vec3(dot(irradiance, vec3(0.3, 0.6, 0.1))),
      uNeutral
    );
  #endif
`;

const ROUGHNESS_CHUNK = /* glsl */ `
  roughnessFactor = mix(0.86, 0.34, finish);
`;

/** A soft sky picked up at grazing angles, stronger the shinier the finish. */
const SHEEN_CHUNK = /* glsl */ `
  {
    vec3 view = normalize(vViewPosition);
    float cosine = clamp(dot(normal, view), 0.0, 1.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - cosine, 5.0);
    vec3 mirrored = inverseTransformDirection(
      reflect(-view, normal), viewMatrix
    );
    vec3 sky = mix(
      vec3(1.5, 1.6, 1.7),
      vec3(0.62, 0.8, 1.15),
      clamp(mirrored.y, 0.0, 1.0)
    );
    reflectedLight.indirectSpecular += sky * fresnel * finish * 0.9 * (1.0 - cut);
  }
`;

/** Adds the model chunks to a `MeshStandardMaterial`'s shaders. */
function patchBuildingShader(shader, tuning) {
  shader.uniforms.uLineStrength = { value: tuning.lineStrength };
  shader.uniforms.uLineHalfM = { value: tuning.lineHalfM };
  shader.uniforms.uBayM = { value: tuning.bayM };
  shader.uniforms.uBayDepth = { value: tuning.bayDepth };
  shader.uniforms.uNeutral = { value: tuning.neutral };
  shader.uniforms.uFill = { value: tuning.fill };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_HEAD}`)
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n${VERTEX_BODY}`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${FRAGMENT_HEAD}`)
    .replace("#include <color_fragment>", COLOUR_CHUNK)
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>\n${ROUGHNESS_CHUNK}`,
    )
    .replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>\n${SHEEN_CHUNK}`,
    );
}

/** The one material every chunk of the model shares. */
export function modelBuildingMaterial(THREE, tuning) {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setScalar(tuning.white),
    vertexColors: true,
    side: THREE.FrontSide,
    flatShading: true,
    roughness: 0.8,
    metalness: 0,
    userData: { neutralSurface: true },
  });
  material.onBeforeCompile = (shader) => patchBuildingShader(shader, tuning);
  material.customProgramCacheKey = () => "v3-model-building";
  return material;
}

/** Rounds the tree crowns: a foam ball, not a faceted gem. */
function roundTrees(material) {
  material.flatShading = false;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      "vec3 objectNormal = normalize(vec3(position.x, position.y * 0.6 + 0.15, position.z));",
    );
  };
  material.customProgramCacheKey = () => "v3-model-tree";
}

/** The harness's `materialFor`: everything joins the model. */
export function modelMaterialFor(kind, material, tuning) {
  if (kind === "ground") {
    material.color.set(tuning.groundColour);
    return material;
  }
  if (kind === "roads") {
    material.vertexColors = false;
    material.color.set(tuning.roadColour);
    material.roughness = 0.92;
    return material;
  }
  if (kind === "trees") {
    material.color.set(tuning.treeColour);
    material.roughness = 0.95;
    roundTrees(material);
    return material;
  }
  return undefined;
}
