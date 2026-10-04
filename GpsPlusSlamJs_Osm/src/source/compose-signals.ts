/**
 * Combining a caller's `AbortSignal` with a per-request deadline.
 *
 * **Lifted out of `elevation/terrarium.ts` rather than copied into
 * `source/overpass-source.ts`** (2026-09-20). It is a one-liner, but it carries
 * a CONTRACT - the abort reason's identity survives composition - and the root
 * `CLAUDE.md` rule is that shared behaviour carrying a contract gets one
 * implementation, while only a contract-free one-liner may exist once per
 * package. Both callers depend on that identity for correctness, so this is the
 * first kind.
 *
 * @see compose-signals.ts.md
 */

/**
 * The signal governing one request: the caller's, the deadline's, or both.
 *
 * `AbortSignal.any` is only reached when there really are two, purely to avoid
 * allocating a composite that stays subscribed to its sources until it is
 * collected. **That is the whole reason, and an earlier version of this comment
 * claimed a second one that is false:** `AbortSignal.any` also preserves its
 * source's `reason` *identity* (the spec assigns the source's reason object to
 * the composite), so an `AbortError` / `TimeoutError` discrimination downstream
 * does not depend on the single-source path at all.
 *
 * **Why that identity is load-bearing, stated here because both callers rely on
 * it and neither states it locally.** A caller's abort must stay a hard abort -
 * the work is abandoned - while a deadline must present as a RETRYABLE
 * transport failure, so the attempt loop moves to the next endpoint instead of
 * killing the tile. `AbortSignal.timeout` yields a `TimeoutError` and
 * `controller.abort()` an `AbortError`; composing must not flatten the two into
 * one reason, or a slow request becomes indistinguishable from a cancelled one.
 *
 * Returns `undefined` when nothing constrains the request, so a caller can
 * spread it away rather than fabricate a never-aborting signal.
 */
export function composeSignals(
  ...signals: readonly (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}
