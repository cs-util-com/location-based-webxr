# `composeSignals`

## Purpose

Combines a caller's `AbortSignal` with a per-request deadline signal into the
one signal a `fetch` should receive, without losing the abort reason's identity.

## Public API

- `composeSignals(...signals: readonly (AbortSignal | undefined)[]): AbortSignal | undefined`
  - Returns `undefined` when every argument is `undefined`, the single signal
    when exactly one is present, and `AbortSignal.any(present)` otherwise.
  - Never throws. Does not copy or wrap a reason.

## Invariants and assumptions

- **The abort reason's IDENTITY survives composition, and both callers depend on
  it for correctness.** `AbortSignal.timeout` rejects with a `TimeoutError`;
  `controller.abort()` rejects with an `AbortError`. `overpass-source.ts` treats
  the first as a retryable transport failure (move to the next endpoint) and the
  second as a hard abort (`isAbortError` makes the attempt loop rethrow). If
  composition flattened the two into one reason, a slow request would become
  indistinguishable from a cancelled one, and every deadline hit would kill the
  tile instead of failing over. Measured in simulation, that mistake drops
  single-cycle success from 97.0% to 54.9%.
- The single-signal fast path is an allocation optimisation only, **not** a
  correctness requirement: `AbortSignal.any` preserves the source reason per
  spec, so the two-signal path discriminates just as well.
- The zero-signal case is unreachable in both current callers and is kept only
  so the helper is total rather than partial.

## Why it is a module rather than two private copies

It was private to `elevation/terrarium.ts` until 2026-09-20, when
`overpass-source.ts` gained a deadline and needed the same composition. The root
`CLAUDE.md` duplication rule allows a contract-free one-liner to exist once per
package, but requires shared behaviour that carries a contract to have one
implementation. The reason-identity guarantee above is exactly such a contract -
and it is the kind that fails silently, since a flattened reason still aborts
the request and only changes which recovery path runs.

## Example

```ts
const deadline =
  this.requestTimeoutMs === undefined
    ? undefined
    : AbortSignal.timeout(this.requestTimeoutMs);
const composed = composeSignals(callerSignal, deadline);
```

## Tests

`compose-signals.test.ts` covers the three arities and pins the reason-identity
guarantee in both directions (a caller abort stays `AbortError`, a deadline
stays `TimeoutError`) under composition.

The behaviour that depends on it is covered where it matters:
`overpass-source.test.ts` "per-attempt transport deadline" asserts that a
deadline is retried onto another endpoint while a caller's abort is not, and
`terrarium.test.ts` covers the elevation path.
