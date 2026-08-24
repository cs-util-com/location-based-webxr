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
 * The three call sites are the AR entry's three fades, which are meant to look
 * like one another. Sharing the curve makes that a fact rather than a
 * coincidence: changing the feel of the entry is now one edit, and cannot
 * accidentally be a partial one.
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
 * **Callers must pass `t` already in `[0, 1]`** — it is not clamped here,
 * because every call site derives `t` from an elapsed-time ratio it has already
 * bounded, and a silent clamp would hide the case where one of them stopped
 * doing that.
 */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
