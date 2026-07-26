# `slam-app-store-listener.ts`

## Purpose

Builds the listener middleware that applies the compass debug/experiment
**opt-in flags** (`coldStartOverrideEnabled`, `compassRotationPriorEnabled`,
`compassWebXRConsistencyEnabled`) once the library `gpsData` slice exists. It is
the structural replacement for the former `store.subscribe` +
`queueMicrotask` + `scheduled`-guard scaffolding in
[`create-slam-app-store.ts`](create-slam-app-store.ts), and mirrors the
established [`tracking-quality.ts`](tracking-quality.ts)
`createTrackingQualityListenerMiddleware` precedent.

## Why it exists (the ordering trap it removes)

The flags live on the `gpsData` slice, which is `null` until the first
`setZeroPos`, so we must dispatch a **follow-up** action in reaction to
`gpsData` appearing. Doing that from a raw `store.subscribe` listener dispatches
**synchronously inside** the trigger's `next()`, and the persistence middleware
([`persistence-middleware.ts`](persistence-middleware.ts)) assigns its replay
index _after_ `next()`. So the nested opt-in gets a **lower** index than the
`setZeroPos` that created `gpsData`, is recorded **before** its trigger, and is
dropped on replay (field bug 2026-06-27, recordings `64c6a294` / `e7431b85`).

A **prepended** listener-middleware effect runs **after** the triggering
dispatch unwinds, so `api.dispatch(...)` here is a top-level dispatch that the
persistence middleware indexes _after_ the trigger → correct replay order **by
construction**, with no `queueMicrotask` / re-entrancy guard to hand-maintain.

See the full analysis and plan:

- [`2026-06-28-0751-subscriber-dispatch-persistence-ordering-review.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-review.md)
- [`2026-06-28-0751-subscriber-dispatch-persistence-ordering-plan.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-plan.md)

## Public API

- `createSlamAppStoreListenerMiddleware(optIns: readonly CompassOptIn[]): Middleware`
  — returns the RTK listener middleware. Register it via `.prepend(...)` in the
  store factory (prepend is required so the effect dispatches **outside** the
  trigger's `next()`).
- `CompassOptIn` — `{ isSet, apply }`:
  - `isSet(state: LibraryRootState): boolean` — whether the flag has already been **DECIDED**, not whether it equals the caller's requested value. See the "value enforcer" invariant below: writing this as `flag === myValue` makes the middleware fight the action stream, which breaks replay.
  - `apply(dispatch): void` — dispatches the action that sets the flag
    (e.g. `dispatch(setColdStartOverrideEnabled(true))`). It receives a bound
    `dispatch` rather than closing over the store, so descriptors can be built
    **before** the store exists (the middleware is passed into `configureStore`).

## Invariants & assumptions

- **`isSet` must mean "decided", never "equals my value" — otherwise this
  middleware becomes a value ENFORCER and fights the recorded action stream.**
  Because the predicate is edge-triggered on the `gpsData` **object reference**
  (below) and every library reducer mutation makes a fresh one, an `isSet` of the
  form `flag === myValue` re-arms on the very action that disagrees with it: a
  replayed `setColdStartOverrideEnabled(true)` would be immediately overwritten
  with `false`, so a session recorded WITH the override replays WITHOUT one.
  - The correct form is `flag !== undefined`. The opt-in supplies the **initial**
    value; the action stream, or any later explicit dispatch, wins.
  - This still satisfies the 2026-06-27 re-apply requirement, because a recreated
    `gpsData` has the flag back at `undefined`.
  - Caught in review on the 1.16.0 bump (2026-07-26), when the store factory
    briefly used `=== enabled` so that an explicit `false` opt-out could be
    dispatched. Pinned by "does NOT overwrite a value the action stream already
    decided" in `create-slam-app-store.test.ts`.
- **Predicate is edge-triggered on the `gpsData` reference, gated by "some flag
  unset".** It fires when `gpsData` is non-null **and** its object reference is
  new since the last apply (`s.gpsData !== lastApplied`) **and** at least one
  opt-in is still unset. The reference guard is what bounds re-firing: a recreated
  `gpsData` (store swap / origin reset) is a fresh object, so it still re-triggers
  the apply — the re-apply semantics the 2026-06-27 field bug demands are
  preserved — but the **same** `gpsData` cannot re-fire. **Do not weaken this to a
  `null → non-null` transition** — that silently drops the re-apply. Earlier this
  was purely level-based (no reference guard); that storms when an opt-in's
  `apply` dispatches but `isSet` never flips true (consumer/library **version
  skew**: the action type no longer matches the reducer), because the condition
  stays true forever and every effect dispatch re-arms it — an unbounded loop that
  freezes the app.
- **Idempotent under re-entrancy.** `isSet` is re-read against the _current_
  store state immediately before each dispatch (not one snapshot at effect
  entry). Redux dispatch is synchronous, so a flag is set before the next check
  runs, and an opt-in's own dispatch re-triggers the predicate (which can
  re-enter the effect) — re-checking per dispatch guarantees each flag is
  dispatched **exactly once** per `gpsData` creation (no duplicate dispatch).
  This re-check guards only against re-dispatching an _already-set_ flag; the
  reference guard above is what stops a _never-set_ flag from looping.
- **Effect dispatches are async** (RTK schedules listener effects after the
  trigger). Tests must `await` (a microtask / `setTimeout(0)`) before asserting.
- The factory registers this middleware whenever `optIns.length > 0`, which since
  2026-07-26 is **always** — the cold-start opt-in is unconditional
  (`recordWhenFalse`), so the old "zero per-action predicate overhead when nothing
  is requested" path is gone. Every store, replay stores included, now runs one
  predicate per action until all its flags are decided.

## Examples

```ts
import { createSlamAppStoreListenerMiddleware } from './slam-app-store-listener';
import { setColdStartOverrideEnabled } from 'gps-plus-slam-js';

const listener = createSlamAppStoreListenerMiddleware([
  {
    // "decided", not "=== true" — see the first invariant above.
    isSet: (s) => s.gpsData?.coldStartOverrideEnabled !== undefined,
    apply: (dispatch) => dispatch(setColdStartOverrideEnabled(true)),
  },
]);

// In configureStore: getDefaultMiddleware().prepend(listener).concat(persistence)
```

## Tests

Covered by [slam-app-store-listener.test.ts](slam-app-store-listener.test.ts):

- Dispatches the opt-in **exactly once**, **after** the trigger (ordering proof
  via an appended action-logging middleware).
- Dispatches every requested opt-in once when several are enabled.
- **Re-applies** the opt-in when `gpsData` is recreated (store-swap / origin
  reset, modelled with a root reducer that resets `gpsData` to `null`).
- Does nothing when no opt-in is requested, and does not fire before `gpsData`
  exists.
- **Does not dispatch-storm** when an opt-in's `apply` never sets its flag
  (version-skew failure mode): the reference guard converges to at most one apply
  per `gpsData` creation instead of looping forever.

The end-to-end recording-fidelity invariant (opt-in persisted **after**
`setZeroPos`, each flag exactly once) is pinned in the RecorderApp's
`recorder-store.test.ts` "persists the compass opt-in AFTER setZeroPos".
