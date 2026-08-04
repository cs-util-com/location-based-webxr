# `isolated-registry.ts` — snapshot-and-isolate callback sets

## Purpose

The shape shared by every callback registry in the framework: a `Set` of
callbacks, snapshotted before iteration, each invoked in isolation so one
throwing entry cannot abort the rest.

## Public API

- `createIsolatedRegistry<A extends readonly unknown[]>({ label, onError? })`
  → `IsolatedRegistry<A>`
  - `register(fn)` → unregister function. Idempotent (backed by a `Set`).
  - `run(...args: A)` — invoke everything, isolated. Membership unchanged.
  - `runOnce(...args: A)` — empty the registry, **then** invoke what it held.
  - `clear()` — drop everything without invoking.
  - `size`, `snapshotCount` — the latter is test-facing.
- `label` names the callback in the default failure log ("FrameUpdate",
  "session disposer") so a logged failure is attributable without a stack.
- `onError` overrides the sink. It exists because a registry of **log**
  subscribers must report through `console.error` — logging a throwing
  subscriber would notify the subscribers, which throws.

## Invariants & assumptions

- **A register/unregister during a `run` is deferred to the next `run`.** This
  is the subtlety the primitive exists to hold: `frame-loop.ts` called
  iterating the live `Set` _"a hard-to-debug source of non-determinism"_,
  because an unregister from inside a tick skips a not-yet-visited entry.
- **The snapshot is cached and invalidated on mutation.** Semantics are
  unchanged by caching; it avoids re-allocating an identical array at 60–90 Hz
  between registry changes, which are rare.
- **`runOnce` clears before invoking.** That is what makes a second flush a
  no-op rather than a double-release, and stops a disposer that re-registers
  during teardown from looping forever. A re-registration survives as a pending
  entry but is not run by the flush that triggered it.
- **A throwing callback never propagates.** Failures go to `onError` or the
  default logger, and the loop continues.

## Performance

`run` takes rest args and spreads them into each callback, which is measurably
slower than a hand-written two-argument loop — **~30–200 ns per frame, at most
about +90 % of a very small number.** Against an 11–16 ms frame budget that is
under 0.001 %, so it is not observable in the app. An arity-specialised `run`
was benchmarked and matched or beat the old code, but cost ~10 lines of
`if (n === 0/1/2)` branching to buy a tenth of a microsecond — rejected as
complexity this primitive exists to remove. Revisit only if a profile ever
points here.

## Examples

```ts
const registry = createIsolatedRegistry<[number, number]>({
  label: 'FrameUpdate',
});
const off = registry.register((dt, elapsed) => tick(dt, elapsed));
registry.run(0.016, 1.25);
off();
```

## Tests

`isolated-registry.test.ts` — argument pass-through, isolation, idempotent
registration, deferral of both registration and unregistration made during a
run, snapshot reuse (asserted via `snapshotCount`, not timing), `clear`,
`runOnce` idempotence, and that a disposer re-registering during teardown does
not loop.

The three adopters (`ar/frame-loop.ts`, `ar/xr-frame-loop.ts`,
`ar/session-disposers.ts`) keep their own suites — 21 tests that now serve as
characterization tests for this extraction.
