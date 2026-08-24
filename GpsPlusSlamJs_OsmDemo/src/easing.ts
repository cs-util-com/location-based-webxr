/**
 * The demo's easing curves.
 *
 * WHY IT EXISTS AS A MODULE. `smoothstep` was written three times in this
 * package — `ar-descent.ts`, `ar-entry-dom-veil.ts` and `ar-entry-veil.ts` —
 * character for character, and the third copy was added on 2026-08-23 in a
 * session whose own plan quotes the rule about searching before adding. The
 * copies were three files apart. That is the evidence that the rule needs a
 * guard rather than a restatement.
 *
 * A FOURTH instance was inline and unnamed, in `terrain-slope.ts`'s
 * `slopeTreatmentStrength` — three NAMED definitions, four uses of the curve.
 * A review found it, which is the practical limit of any guard keyed on a name:
 * an expression nobody named is invisible to it.
 *
 * Three of the four call sites are the AR entry's fades, which are meant to
 * look like one another. Sharing the curve makes that a fact rather than a
 * coincidence: changing the feel of the entry is now one edit, and cannot
 * accidentally be a partial one — and the ground treatment now moves with it,
 * which it silently would not have before.
 *
 * NOT SHARED WITH THE FRAMEWORK, deliberately. `AppFramework`'s
 * `visualization/occlusion-mesh.ts` has a `smoothstep(edge0, edge1, x)` — the
 * three-argument GLSL form, mirroring a shader it sits beside. Folding these
 * together would make one of the two read wrongly for its own context, and a
 * cross-package import edge for a one-liner is not worth it (owner decision
 * DEC-H3, 2026-08-24).
 *
 * @see easing.ts.md
 */

/**
 * The classic smoothstep on `[0, 1]`: zero slope at both ends, so neither the
 * start nor the end of a fade steps.
 *
 * **Callers must pass `t` already in `[0, 1]`** — it is not clamped here. The
 * AR-entry fades each derive `t` from an elapsed-time ratio they have already
 * bounded; `terrain-slope.ts` clamps at its own call site because its `t` is a
 * ratio of physical quantities that genuinely can exceed 1. Clamping here would
 * erase that distinction, and would hide the day one of the fades stopped
 * bounding its own input.
 */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
