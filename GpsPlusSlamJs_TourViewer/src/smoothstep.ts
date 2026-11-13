/**
 * The GLSL smooth step: 0 at `edge0` and below, 1 at `edge1` and above,
 * 3t^2 - 2t^3 between (edges in either order). The package's one copy (a
 * one-liner may exist once per package): the framework's
 * `utils/smoothstep.ts` is no deep-import entry of its build, and making it
 * one would put every dependent of the framework behind this package's
 * change. Outside the editor's folders, so the visitor's pages may use it.
 *
 * @see smoothstep.ts.md
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
