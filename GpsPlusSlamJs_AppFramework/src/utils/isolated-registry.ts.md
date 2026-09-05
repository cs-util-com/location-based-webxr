# `isolated-registry.ts` — snapshot-and-isolate callback sets

## Purpose

The shape shared by every callback registry in the framework: a `Set` of
callbacks, snapshotted before iteration, each invoked in isolation so one
throwing entry cannot abort the rest.

## Public API

- `createIsolatedRegistry<A extends readonly unknown[]>({ onError })`
  → `IsolatedRegistry<A>`
  - `register(fn)` → unregister function. Idempotent (backed by a `Set`).
  - `run(...args: A)` — invoke everything, isolated. Membership unchanged.
  - `runOnce(...args: A)` — empty the registry, **then** invoke what it held.
  - `clear()` — drop everything without invoking.
  - `size`, `snapshotCount` — the latter is test-facing.
- **`onError` is REQUIRED, and there is no `label`.** Both follow from one
  constraint: **this module imports nothing.** A `createLogger` import here
  would make `logger.ts` — whose subscriber list is one of these registries —
  a `logger → isolated-registry → logger` cycle, which the `check:cycles` gate
  rejects. With no logger there is no default sink to name, so the `label` a
  draft carried became a field nothing read and could silently disagree with
  the message beside it.
- Requiring the sink also buys two things: each registry keeps its **own**
  logger name (`FrameLoop`, `XrFrameLoop`, …) instead of collapsing every
  failure under one, and nobody can adopt this silently in a context where
  logging recurses — which is exactly `logger.ts`'s, where reporting a throwing
  subscriber through the logger would notify the subscribers and throw again.

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
- **A throwing callback never propagates.** Failures go to `onError` and the
  loop continues.
- **A throwing `onError` never propagates either**, and that is not
  belt-and-braces: the sink is caller-supplied, so without it a failing _report_
  would abort the dispatch it was reporting on — the isolation mechanism taking
  down the thing it exists to protect. It is swallowed rather than re-thrown
  because there is no second channel to report it through; the sink IS the
  channel. Found by a test, not by review.

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
  onError: (err) =>
    log.error('A registered FrameUpdate threw; continuing', err),
});
const off = registry.register((dt, elapsed) => tick(dt, elapsed));
registry.run(0.016, 1.25);
off();
```

## Tests

`isolated-registry.test.ts` — argument pass-through, isolation, idempotent
registration, deferral of both registration and unregistration made during a
run, snapshot reuse (asserted via `snapshotCount`, not timing), `clear`,
`runOnce` idempotence, that a disposer re-registering during teardown does not
loop, that failures reach the caller's sink, and that a **throwing sink** does
not abort the dispatch.

The six adopters keep their own suites, which served as the characterization
tests for this extraction:

- `ar/frame-loop.ts`, `ar/xr-frame-loop.ts`, `ar/session-disposers.ts` — the
  three registries the shape was extracted from.
- `utils/logger.ts` — the log-subscriber list, and the reason `onError` is
  required rather than defaulted.
- `ar/enable-gps-ar.ts` — the controller's state listeners.
- `sensors/permission-checker.ts` — the per-subscription cleanup list, which
  uses `runOnce` for its one-shot teardown.
