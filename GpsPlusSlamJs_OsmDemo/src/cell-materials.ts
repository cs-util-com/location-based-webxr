/**
 * The affordance grid's two materials, built where a test can reach them.
 *
 * **WHY THEY LEFT `building-view.ts` (r508 review).** They were constructed
 * inline inside `drawCells`, which cannot run without a `WebGLRenderer` — so
 * nothing could assert anything about them, and AR milestone 2's guard on "the
 * content is still visible once the environment map is gone" silently covered
 * the mesh layers and skipped the grid. The face material is the ONE material
 * in the AR set carrying an `onBeforeCompile` patch, which
 * `installCellEmissive` names as "the surface that took the entire scene off
 * screen for ten work items" — the one it most needed to cover.
 *
 * The M2 guard's stand-in was a check that the DEFAULT PRESET has `fog: true`.
 * That is a fact about `cell-presets.ts`, not about the material: hard-coding
 * `fog: false` here would break the behaviour it named and leave it green. A
 * check on the wrong object reads exactly like coverage, which is why the
 * extraction was worth doing rather than documenting the gap.
 *
 * Nothing about the look changed in the move.
 *
 * @see cell-materials.ts.md
 */

import * as THREE from "three";

import type { CellPreset } from "./cell-presets.js";

/**
 * How much of the cell's own colour is added back as emissive.
 *
 * Lighting dims the vertex colour, and for this grid the colour IS the data —
 * a uniformly dimmed ramp is a picture that disagrees with the legend beside
 * it. Adding it back as emissive restores the value while leaving the specular,
 * which is the whole reason the material is lit at all.
 */
const CELL_EMISSIVE_INTENSITY = 0.5;

/**
 * Patch a lit material to add its vertex colour back as emissive.
 *
 * THE RISK, NAMED. `onBeforeCompile` is the surface that took the entire scene
 * off screen for ten work items when `scene.environment` was set: three logs a
 * shader-compilation failure and then silently does not draw the material. This
 * patch is one additive line against `totalEmissiveRadiance`, a `vec3` that
 * exists in every lit fragment shader, and `installGroundDisplacement` in
 * `ground-slope-shader.ts` establishes the same pattern. The e2e that counts
 * cell pixels is what catches it if that stops being true.
 */
function installCellEmissive(
  material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uCellEmissive"] = { value: CELL_EMISSIVE_INTENSITY };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uCellEmissive;`,
      )
      // AFTER the emissive chunk, so this adds to whatever it produced rather
      // than being overwritten by it.
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        #ifdef USE_COLOR_ALPHA
          totalEmissiveRadiance += vColor.rgb * uCellEmissive;
        #endif`,
      );
  };
  // Changing `onBeforeCompile` after a program exists needs this; harmless here
  // because the material is new, and correct if this is ever reused.
  material.needsUpdate = true;
  return material;
}

/**
 * The grid's face material for a given preset.
 *
 * LIT SINCE DEC-S1/S2, and it was `MeshBasicMaterial` before. That choice was
 * not an oversight — an unlit material draws the vertex colour and stops, so the
 * score colour could not be dimmed by lighting and the picture could not lie
 * about the analysis.
 *
 * WHAT MAKES LIGHTING SAFE HERE, and it is worth checking before anyone
 * "restores" the old material: every cell is horizontal and coplanar with every
 * other, there are no shadow maps (DEC-R4-6 deferred them), and the sun holds a
 * fixed elevation while only its azimuth follows the camera. So the diffuse term
 * is the SAME CONSTANT for every cell and stays constant as the camera orbits —
 * the ramp is scaled, never reordered. What the lighting adds on top is the
 * specular, which is the whole point.
 *
 * The rim normals from `cell-bevel.ts` deliberately break that flatness at the
 * corners. That is decoration on the edge; the tile's face keeps its value, and
 * the bevel is symmetric so no cell picks up a net tilt.
 */
export function cellFaceMaterial(
  preset: CellPreset,
): THREE.MeshStandardMaterial {
  return installCellEmissive(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      // 0.8, UP FROM 0.55 (DEC-S1). The specular is exactly the part alpha
      // eats, so at 0.55 the highlight this material exists for was 55 % of a
      // highlight. Two costs were accepted with it: the ground beneath — the
      // height ramp included, which is the default surface since DEC-R5-4 — is
      // largely hidden where cells cover it, and the 2D map stays at 0.55, so
      // "the same cell reads as the same strength of claim in both views" is no
      // longer literally true. The overlap is a ~326 m disc on a 4.8 km plane,
      // which is what makes the first cost bearable.
      // FROM THE PRESET SINCE §3 (DEC-R6-9). 0.8 is the shipped default and
      // stays the default; the other values are reachable by hotkey so the
      // trade can be judged by looking rather than argued.
      opacity: preset.opacity,
      // Low, for a tight specular lobe — the same mechanism DEC-R2-1 chose for
      // the ground, where it is 0.42.
      roughness: 0.2,
      // ZERO, AND AR DEPENDS ON IT. `ar-content-materials.test.ts` pins this:
      // the AR scene has no environment map by design, and a metallic material
      // has no diffuse term, so it would compile, draw, and be black.
      metalness: 0,
      side: THREE.DoubleSide,
      // FOG IS AN AXIS (§3). It is a no-op today — the cells reach ~326 m, the
      // desktop haze starts at 1584 m and AR's at 400 m — and stops being one
      // after §6 widens the radius, which is exactly why DEC-R6-22 keeps the
      // presets alive until then.
      fog: preset.fog,
      // TRANSPARENT ONLY WHEN IT HAS TO BE. A fully opaque preset that still
      // declared `transparent: true` would keep paying the transparent render
      // pass — no depth write, no early-z, sorted every frame — for nothing,
      // which is exactly the +30 % the shiny-surfaces work measured and did not
      // address.
      transparent: preset.opacity < 1,
      depthWrite: preset.opacity >= 1,
    }),
  );
}

/**
 * The grid's outline material.
 *
 * Takes no preset: the outline treatment is a per-cell decision carried in the
 * vertex colours (DEC-R3-21), not a look axis.
 */
export function cellOutlineMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  });
}
