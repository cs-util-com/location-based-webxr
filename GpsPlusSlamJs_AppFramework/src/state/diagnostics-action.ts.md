# `diagnostics-action.ts`

## Purpose

One action, `diagnostics/note`, dispatched **to be written into a recording**
and for nothing else. It is how an app puts a measurement it made about itself —
how long the AR entry waited, how long the elevation estimator took to engage —
somewhere it can still be read after the session is over.

## Public API

- `DiagnosticNote` — `{ kind, atMs, detail }`.
  - `kind` — a stable slug (`"ar-entry-ready"`), not prose. The value of a
    recording is being able to find every instance of one measurement across
    many sessions, and sentences do not group.
  - `atMs` — **epoch milliseconds, by contract**; supplied rather than taken
    here so the caller controls which moment is stamped. A caller measuring on
    another clock (XR frame clock, `performance.now()`) converts once at
    dispatch, as `main.ts` does with `nowEpochMs()`. The domain is fixed
    because a note is read back months later out of a zip, and because the
    replay engine's `extractActionTimestamp` paces recordings by this field —
    a frame-clock value would compute garbage delays against the epoch-stamped
    GPS stream.
  - `detail` — flat, and restricted to `number | string | boolean | null`. The
    action is JSON-serialised into the zip and RTK's serialisable check runs
    over it, so a `Date`, a `Map` or a class instance would either warn in
    development or round-trip into something else.
- `recordDiagnostic(note)` — the action creator. Plain `createAction`; there is
  no slice and no reducer.

## Invariants & assumptions

- **No reducer, deliberately.** The owner's requirement was that it be _"not
  really consumed by the store"_. `createPersistenceMiddleware` writes each
  action **after** `next(action)` has run, and every slice is a plain RTK
  `createSlice` that ignores an unmatched type — so a reducer-less action is
  persisted exactly like any other and changes nothing. A reducer added later
  would make the action ambiguous: is the recording the record, or is the state?
  The absence is asserted by a test rather than left to convention.
- **The slice prefix is the entire contract with persistence.** The middleware
  keeps a whitelist and drops everything else **silently** — no warning, no
  error, no file. `diagnostics` is in `BUILTIN_PERSISTED_PREFIXES`, derived
  through `slicePrefixOf(recordDiagnostic.type)` rather than written as a
  literal: a hand-typed `refPointsV2/` outlived its slice's rename once and took
  that slice's actions out of every recording.
- **Built in rather than opt-in.** The value is that a recording made by _any_
  consumer can be asked what happened; an app that never dispatches one pays
  nothing for the prefix being listed.
- **Only recorded while a session is running.** The middleware's session gate
  applies here like anywhere else, so a diagnostic dispatched outside a
  recording is a no-op rather than a stray file.
- ⚠️ **It is INERT in the OSM demo today.** That app builds its store with a
  `NullStorageBackend` by explicit design — _"this demo records nothing, and a
  real backend here would start writing GPS actions to OPFS behind the user's
  back"_ — so its diagnostics are dropped. It ships anyway, at the owner's
  instruction, so that nothing else has to be built the day that demo records.
  The trade-off is written up in
  `GpsPlusSlamJs_Docs/docs/2026-08-23-2335-diagnostic-actions-into-recordings-findings.md`.

## Example

```ts
import { recordDiagnostic } from 'gps-plus-slam-app-framework/state';

store.dispatch(
  recordDiagnostic({
    kind: 'ar-entry-ready',
    atMs: Date.now(), // epoch ms — convert here if measured on another clock
    detail: { afterS, aligned, contentReady },
  })
);
```

## Tests

`diagnostics-action.test.ts` — the type string and its prefix (asserted
directly, because a typo there produces an action that dispatches cleanly and is
never written anywhere), the payload passing through untouched, the round trip
into a recording backend while a session runs, the no-write outside a session,
and that dispatching it leaves the whole state object unchanged.

## Related

- [`persistence-middleware.ts`](./persistence-middleware.ts.md) — the prefix
  whitelist and the post-reducer write.
- [`create-slam-app-store.ts`](./create-slam-app-store.ts.md) — where the prefix
  is registered.
- [`replay-engine.ts`](./replay-engine.ts.md) — paces replay by `atMs`, which
  is why the epoch-ms domain is part of the contract.
