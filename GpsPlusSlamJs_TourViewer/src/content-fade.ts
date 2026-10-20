/**
 * Fading a three.js subtree in and out (visitor plan 2026-10-18-2349 §3:
 * a station's content fades in on entering and out on leaving, and a
 * story's figure fades with its station).
 *
 * - `setSubtreeOpacity(root, alpha)` multiplies every material's OWN
 *   opacity by `alpha` (0..1). The material's own values are remembered the
 *   first time it is touched, so a pill label that is transparent at 0.9
 *   stays 0.9 at full alpha, and an opaque photo plane becomes opaque again
 *   (`transparent` back to its own value) once `alpha` reaches 1: an opaque
 *   plane drawn in the transparent pass would stop occluding what is behind
 *   it for good.
 * - `stepAlpha` moves an alpha towards its target at a constant rate (the
 *   whole range in `fadeMs`), so a fade reversed half way takes half the
 *   time back.
 *
 * Pure apart from the materials it writes.
 */

import type { Material, Object3D } from "three";

/**
 * The fade's length (ms), in and out alike: the plan's "about 0.4 s".
 * Swept 200-1000 ms through the side table at 30 frames a second
 * (`station-content.sweep.test.ts`). A switch (out, then in) takes two
 * fades, so staying under 1 s needs less than 500 ms; a step per frame of
 * at most 10 % (a fade, not a pop) needs at least 334 ms. 400 ms sits in
 * that window and carries a leaving station's content about 0.6 m past its
 * exit at a walk of 1.4 m/s. Reversed by a phone where 400 ms reads as a
 * pop (600 ms: a 1.2 s switch) or a museum where 0.8 s per switch reads as
 * slow (250 ms: 13 % steps at 30 fps).
 */
export const CONTENT_FADE_MS = 400;

interface OwnLook {
  readonly opacity: number;
  readonly transparent: boolean;
}

const ownLook = new WeakMap<Material, OwnLook>();

function materialsOf(object: Object3D): Material[] {
  const raw = (object as { material?: Material | Material[] }).material;
  if (raw === undefined || raw === null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/** Every material under `root` at `alpha` times its own opacity. */
export function setSubtreeOpacity(root: Object3D, alpha: number): void {
  const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
  root.traverse((object) => {
    for (const material of materialsOf(object)) {
      let own = ownLook.get(material);
      if (own === undefined) {
        own = {
          opacity: material.opacity,
          transparent: material.transparent,
        };
        ownLook.set(material, own);
      }
      const transparent = a < 1 ? true : own.transparent;
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = own.opacity * a;
    }
  });
}

/**
 * `alpha` moved towards `target` over `elapsedMs`, at the rate that crosses
 * the whole range in `fadeMs` (a non-positive `fadeMs` jumps). A negative or
 * nonsense elapsed time moves nothing.
 */
export function stepAlpha(
  alpha: number,
  target: number,
  elapsedMs: number,
  fadeMs: number,
): number {
  if (!(fadeMs > 0)) return target;
  const step =
    Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / fadeMs : 0;
  return target > alpha
    ? Math.min(target, alpha + step)
    : Math.max(target, alpha - step);
}
