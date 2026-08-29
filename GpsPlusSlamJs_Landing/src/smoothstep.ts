/**
 * The landing page's one smoothstep.
 *
 * WHY IT EXISTS AS A MODULE. The curve was written three times in this
 * package — `hero-veil.ts`, `scene/sky-dome.ts` and `scene/portal.ts` — as the
 * bare expression `t * t * (3 - 2 * t)`, never named. **Nothing could have
 * caught that.** `tests/repo-config/duplicate-helpers.test.js` holds
 * `smoothstep` to one definition per package, but it matches DECLARATIONS: an
 * expression nobody named is invisible to it, and `check:dup` runs jscpd at a
 * 50-token floor, which a nine-token expression never reaches. The same thing
 * happened in `GpsPlusSlamJs_OsmDemo` (see its `easing.ts`), where a fourth,
 * inline instance was found by a human reviewer after three named ones had
 * already been unified.
 *
 * All three call sites clamped first, and each wrote that inline too — as
 * `Math.min(1, Math.max(0, x))`, beside a `clamp01.ts` that has existed in this
 * package the whole time. So the same three lines carried two separate
 * duplications.
 *
 * NOT SHARED WITH THE FRAMEWORK, deliberately, and this package does not
 * depend on it (owner decision DEC-H3, 2026-08-24: shared BEHAVIOUR is unified
 * across packages, pure one-liners are not). `AppFramework`'s
 * `visualization/occlusion-mesh.ts` carries the three-argument GLSL form
 * `smoothstep(edge0, edge1, x)`, which mirrors a shader line for line and is
 * not interchangeable with this.
 *
 * @see smoothstep.ts.md
 */

/**
 * The classic smoothstep on `[0, 1]`: zero slope at both ends, so neither the
 * start nor the end of a fade steps.
 *
 * **Callers must pass `t` already in `[0, 1]`** — it is not clamped here, and
 * that is the same convention `GpsPlusSlamJs_OsmDemo/src/easing.ts` uses.
 * Clamping inside would hide the day a caller's `t` silently leaves range,
 * which is a real bug in a scroll-driven page where `t` is a ratio of
 * measured spans. Every current caller clamps with {@link clamp01}, whose
 * non-finite → `0` contract is what keeps a `NaN` out of a colour lerp.
 */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
