/**
 * The Globe package's easing curve, in a module with no imports: the sky
 * level (`sky-level.ts`) reads it, and pages without an import map load
 * that (the terrain lab's colour comparison page), so it must not pull in
 * "three" through `globe-camera.ts` (r766 milestone run, 2026-10-04).
 *
 * @see globe-ease.ts.md
 */

/** Hermite ease on [0, 1], clamped outside it. */
export function smoothstep(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}
