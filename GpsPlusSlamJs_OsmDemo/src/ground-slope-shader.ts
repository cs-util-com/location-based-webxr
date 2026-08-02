/**
 * The GLSL half of §2: slope isoclines, aspect tint and a rim light, patched
 * into `MeshStandardMaterial`.
 *
 * WHY A PATCH AND NOT A `ShaderMaterial` (DEC-R6-7). The prototype is a standalone
 * `ShaderMaterial`, and porting it verbatim would silently lose FOUR things the
 * ground already has: PBR response, the environment map §1 just adopted, fog,
 * and the GPU displacement patch. Losing the environment map one stage after
 * adopting it would be self-defeating, and reimplementing three's fog and IBL
 * chunks by hand is a large amount of shader we would own forever — on the
 * surface that has already taken the whole scene off screen once.
 *
 * WHAT MAKES STRING PATCHING SURVIVABLE HERE, since it is otherwise a bad idea.
 * Three things, and the third is the one that matters:
 *
 * - The anchors are three's own `#include` markers, which are stable API in
 *   practice — `installGroundDisplacement` and `installCellEmissive` already
 *   depend on them.
 * - The maths is NOT in the shader alone. `terrain-slope.ts` is the same
 *   arithmetic in JS, unit-tested, and this mirrors it.
 * - **A patch whose anchor moved is a SILENT no-op**, so the anchors are
 *   asserted against three's actual shader source in
 *   `ground-slope-shader.test.ts`. That test is the whole reason this file can
 *   be trusted across a three upgrade.
 *
 * IT CHAINS RATHER THAN REPLACES. `material.onBeforeCompile` is a single
 * function, so assigning it here after `installGroundDisplacement` would throw
 * the displacement away — the ground would flatten, silently, and only in GPU
 * mode. Any existing hook is captured and called first.
 *
 * @see ground-slope-shader.ts.md
 */

import type * as THREE from "three";

import { FLAT_FADE_STEEPNESS, ISOCLINE_FREQUENCY } from "./terrain-slope.js";

/**
 * The `#include` markers this patch depends on, so a test can assert they exist.
 *
 * Exported as data rather than checked inline: the failure being guarded against
 * is a three upgrade renaming a chunk, and that has to fail in CI rather than at
 * a user's GPU — where it produces an untreated ground and no error at all.
 */
export const SLOPE_SHADER_ANCHORS = {
  vertex: ["#include <common>", "#include <defaultnormal_vertex>"],
  fragment: ["#include <common>", "#include <opaque_fragment>"],
} as const;

/** Uniforms the patch adds, shared so one write reaches every ground material. */
export interface SlopeUniforms {
  /** 1 while the treatment is on, 0 while the ground is plain. */
  readonly uSlope: { value: number };
}

/**
 * Adds the slope treatment to a material, keeping any existing compile hook.
 *
 * The treatment is three separable things, all from the prototype:
 *
 * - **Aspect tint** — the compass direction of the lean, mapped to a warm/cool
 *   shift. This is what distinguishes two slopes of equal steepness facing
 *   different ways; without it a valley and a ridge of the same gradient render
 *   identically.
 * - **Isoclines** — contour lines of constant STEEPNESS, not of constant height.
 *   `fwidth` keeps them one pixel wide at any distance, which is the single
 *   trick that makes them look right at a 2400 m far plane and the reason this
 *   could not be done on the CPU as vertex colours.
 * - **Rim light** — brightens grazing angles, which picks out creases.
 *
 * All three fade out below {@link FLAT_FADE_STEEPNESS}, so genuinely flat ground
 * reads as untreated rather than as uniformly inside or outside a line.
 */
export function installGroundSlope(
  material: THREE.Material,
  uniforms: SlopeUniforms & Record<string, { value: unknown }>,
): void {
  // BOUND, not just captured. `onBeforeCompile` is a method, and three's default
  // implementation is a no-op on the prototype — pulling it off the object
  // unbound is what the `unbound-method` rule is warning about, and binding is
  // also what keeps a previous hook that DOES use `this` working.
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    // CHAINED, NOT REPLACED. See the header: overwriting the displacement hook
    // would flatten the terrain in GPU mode with nothing reported.
    previous(shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGroundWorldNormal;`,
      )
      .replace(
        "#include <defaultnormal_vertex>",
        `#include <defaultnormal_vertex>
        // WORLD space, not view space. three's own \`vNormal\` is view-space, and
        // steepness is meaningless there — it would change as the camera moved.
        // \`objectNormal\` is used rather than \`transformedNormal\` so this picks
        // up the displacement patch's rewritten normal, which runs earlier in
        // \`<beginnormal_vertex>\`.
        vGroundWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGroundWorldNormal;
        uniform float uSlope;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          if (uSlope > 0.5) {
            vec3 gn = normalize(vGroundWorldNormal);
            // Mirrors \`slopeSteepness\`: length of the horizontal part of a unit
            // normal, i.e. sin(slope angle). Bounded by 1, which is what lets
            // the frequency below be a fixed number.
            float steepness = length(gn.xz);
            // Mirrors \`slopeTreatmentStrength\`. Flat ground has no defined
            // aspect and a degenerate phase, so it is faded out rather than
            // drawn arbitrarily.
            float strength = smoothstep(0.0, ${FLAT_FADE_STEEPNESS.toFixed(3)}, steepness);

            // ASPECT TINT. Mirrors \`slopeAspect\`.
            float aspect = atan(gn.x, gn.z);
            float warmth = (sin(aspect) + 1.0) * 0.5;
            vec3 cool = vec3(0.10, 0.25, 0.35);
            vec3 warm = vec3(0.35, 0.20, 0.15);
            vec3 tint = mix(cool, warm, warmth);
            outgoingLight = mix(
              outgoingLight,
              outgoingLight * (0.65 + tint),
              strength * 0.5
            );

            // ISOCLINES. Mirrors \`isoclinePhase\`. \`fwidth\` is what keeps the
            // line one PIXEL wide however far away the ground is — the trick
            // that cannot be reproduced on the CPU, and the reason DEC-R6-7
            // rejected doing this as vertex colours.
            float phase = steepness * ${ISOCLINE_FREQUENCY.toFixed(1)};
            float width = fwidth(phase);
            float line = smoothstep(width * 1.5, 0.0, abs(fract(phase) - 0.5));
            outgoingLight = mix(outgoingLight, vec3(0.62, 0.74, 0.92), line * strength * 0.55);

            // RIM. Brightens grazing angles, which is what picks out a crease.
            vec3 viewDir = normalize(vViewPosition);
            float rim = smoothstep(0.6, 1.0, 1.0 - max(dot(viewDir, normal), 0.0));
            outgoingLight += vec3(0.20) * rim * strength;
          }
        }
        #include <opaque_fragment>`,
      );
  };
  // Materials are cached by program; changing the compile hook has to invalidate
  // that cache or the patch never reaches the GPU.
  material.needsUpdate = true;
}
