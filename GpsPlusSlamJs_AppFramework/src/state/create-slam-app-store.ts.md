# `create-slam-app-store.ts`

## Purpose

Composable Redux store factory for any AR+GPS application built on
`gps-plus-slam-app-framework`. Wires the library reducers
(`gpsData` / `gpsElements` / `arElements`), the framework-owned recording
lifecycle slice (`recorder`), and the persistence middleware. Caller-supplied
slices and middleware plug in via `extraReducers` / `extraMiddleware`.

Introduced in **Iter 1** of the
[AppFramework / RecorderApp boundary migration plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
Replaces the recorder-flavoured `createRecorderStore` in
[store.ts](store.ts) for non-recorder consumers; the recorder will keep a
thin `createRecorderStore` that calls this factory with its own extras.

## Public API

- `createSlamAppStore<ExtraReducers>(options)` — returns a `SlamAppStore`.
- `SlamAppStore<ExtraReducers>` — opaque store with `getState` / `dispatch` /
  `subscribe` / `writeFrame` / `writeSessionMetadata` /
  `flushPendingActionWrites` (drains the persistence middleware's async
  WriteQueue — the stop flow MUST await it before reading the session's
  `actions/` for the final sync / ZIP export, 2026-07-12).
- `SlamAppStoreOptions<ExtraReducers>` — `{ storageBackend, extraReducers?, extraMiddleware?, persistedExtraPrefixes?, onWriteFailure?, enableDevChecks?, licenseKey?, trackingQualityOptions?, enableCompassColdStartOverride? }`.
  - `enableCompassColdStartOverride` (**default `true`** — Phase-4 Stage-0 is a field-validated, default-on feature) — a prepended listener middleware ([`slam-app-store-listener.ts`](slam-app-store-listener.ts)) dispatches the library's `setColdStartOverrideEnabled(<the option's value>)` the first time `gpsData` becomes non-null (right after the first `setZeroPos`, since the flag lives on that slice and can't be set before it exists). Enables the cold-start compass override (orients the world immediately at cold start, hands back to GPS once the yaw is observable). Pass `false` to opt out (the recorder surfaces this as a settings toggle). **The value is dispatched explicitly, `false` included** — see the invariant below on why dispatching only on `true` was a replay-fidelity bug once the library default flipped in gps-plus-slam-js 1.16.0. A recording carrying `setColdStartOverrideEnabled(true)` replays with the override on and one carrying `false` replays with it off, independent of the library default, so collect §6a field-calibration recordings with this OFF. See [`GpsPlusSlamJs_Docs/docs/2026-06-26-0701-stage0-field-collection-and-enablement.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-26-0701-stage0-field-collection-and-enablement.md). The two sibling flags `enableCompassRotationPrior` and `enableCompassWebXRConsistency` stay **default OFF** (field-gated) and behave identically for their respective `gpsData` flags when enabled. The 2026-07-19 field-test opt-ins `enableCompassExperiment` (library combo: rotation prior + trust tolerance 15° + C′ pair selection via `setCompassExperimentEnabled`) and `enableRobustSolverComparison` (alternative robust-solver A/B arm via `setRobustSolverComparisonEnabled` — NOT a compass mechanism) follow the same pattern, default OFF; see the private repo's [compass-experiment recorder enablement plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-19-0813-compass-experiment-recorder-enablement-plan.md). `compassVoteWeight` (number ∈ [0,1], absent ⇒ library default) rides the same opt-in mechanism and carries the recorder's vote-weight slider (2026-07-19 weight-curve follow-up); only consulted while a rotation prior is active.
- `SlamAppRootState` — base state shape (no extras).
- `SlamAppCombinedState<ExtraReducers>` — base state plus typed extras.
- `SlamAppMiddleware` — middleware signature accepted by `extraMiddleware`.

## Invariants & assumptions

- **`enableCompassColdStartOverride` dispatches its actual value, `false` included**
  — it is the one row marked `recordWhenFalse`. The other four boolean opt-ins are
  still dispatch-on-`true`, deliberately: recording all five unconditionally added
  four no-op actions to every recording (measured: a minimal session went from 1
  opt-in action to 5) to fix one flag, and their library defaults are `false`, so
  for them "absent ⇒ off" is a stable contract. **Any flag whose library default
  stops being `false` must gain the marker** — that rule is stated on the field
  itself so it travels with the code.
  Do not "optimise" the marked row back to `rows.filter((r) => r.enabled)`. That shape left
  the `gpsData` flag `undefined` on an explicit opt-OUT, and the library reads
  `undefined` as "use `DefaultAlignmentConfig`" — equivalent only while the library
  default was also `false`. When gps-plus-slam-js **1.16.0** flipped
  `useCompassColdStartOverride` to `true`, `enableCompassColdStartOverride: false`
  silently began meaning **ON**, which broke replay of any recording captured
  without the override (`RecorderApp`'s `replay-mode.ts` passes exactly that
  `false`). Dispatching the value makes the persisted action stream state which
  compass configuration a session ran with, so no future library-default change can
  reinterpret an existing recording.
  - The bug survived because the test asserted `toBeFalsy()`, which `undefined`
    satisfies. The regression tests now assert `toBe(false)` and cover both values.
  - Consequence accepted: the listener middleware is always registered, so the
    "no opt-in requested ⇒ zero per-action overhead" path is gone. Already moot,
    since `enableCompassColdStartOverride` defaults to `true` here.
  - Scope of "no future library-default change can reinterpret an existing
    recording": true for recordings made from 1.16.0 onward. Recordings made
    **before** it with the override off carry no opt-in action at all, so faithful
    replay of those depends on the replaying consumer passing `false` explicitly.
    `RecorderApp`'s `replay-mode.ts` does.
  - **The opt-in supplies an INITIAL value; the action stream wins.** `isSet` is
    `flag !== undefined` ("decided"), never `flag === enabled`. The latter turns
    the listener middleware into a value enforcer that overwrites a replayed
    `setColdStartOverrideEnabled(true)` with the option's `false` — the same
    replay defect inverted. Full reasoning in
    [`slam-app-store-listener.ts.md`](slam-app-store-listener.ts.md); pinned by
    "does NOT overwrite a value the action stream already decided".
- `storageBackend` is **required**. Tests / replay paths must pass
  `NullStorageBackend`. The factory does not silently fall back to OPFS — the
  caller decides.
- `licenseKey` defaults to the bundled `COMMUNITY_LICENSE_KEY`. Validation
  always runs (`validateLicenseKey`) and throws on invalid / expired / empty
  keys; there is no bypass.
- `extraReducers` keys must not collide with the framework-reserved slice keys
  (`gpsData`, `gpsElements`, `arElements`, `recording`, `tracking`,
  `trackingQuality`). The factory **throws at construction** naming every
  colliding key (2026-07-04, PR #17 review) — previously the spread silently
  replaced the built-in reducer, corrupting framework state with no diagnostic.
- `extraMiddleware` is appended **after** the persistence middleware, so
  consumer middleware sees actions that have already been persisted.
- **Persisted-action whitelist is slice-derived, not literal.** The factory
  builds the persistence middleware's `persistedPrefixes` from the actual
  action creators: `slicePrefixOf(setZeroPos.type)` (`gpsData`) and
  `slicePrefixOf(recordWriteFailure.type)` (`recording`), plus any
  `persistedExtraPrefixes` the caller supplies. The recorder passes
  `slicePrefixOf(addRefPointEntry.type)` (`refPoints`). Callers MUST derive
  these from the slice (never hand-type a literal) so a slice rename cannot
  silently drop its actions from recordings — see
  [persistence-middleware.ts.md](persistence-middleware.ts.md) and the
  2026-05-29 architecture review (§5 P0).
- **Compass opt-ins (`enableCompass*`) are applied by a prepended listener
  middleware, never a synchronous `store.subscribe` dispatch.** Each opt-in lives
  on the `gpsData` slice, which is null until the first `setZeroPos`, so
  [`createSlamAppStoreListenerMiddleware`](slam-app-store-listener.ts) re-applies
  it whenever `gpsData` becomes a **new object reference** with the flag still
  unset — **edge-triggered on `gpsData` identity** via a `s.gpsData !== lastApplied`
  guard, NOT a level-based predicate. A recreated `gpsData` (store swap / origin
  reset) is a fresh reference so the opt-in still re-applies, while the reference
  guard stops the effect re-firing for the same `gpsData`. (The earlier purely
  level-based predicate — "fire while the flag is unset" — caused a dispatch storm
  on consumer/library version skew where the flag never sets; the reference guard
  is what bounds it. See [`slam-app-store-listener.ts`](slam-app-store-listener.ts).)
  A prepended listener-middleware **effect runs after the
  triggering dispatch unwinds**, so the opt-in is a top-level dispatch that the
  persistence middleware indexes AFTER `setZeroPos` → correct replay order **by
  construction**. This replaced the former `queueMicrotask` + `scheduled`-guard +
  `store.subscribe` scaffolding: a synchronous subscriber dispatch runs within the
  trigger's `next()`, and the persistence middleware enqueues _after_ `next()`, so
  it would be persisted with a LOWER index than the `setZeroPos` that created
  `gpsData`, and a replay would drop it (gpsData still null at that index) — the
  override looked OFF on replay though it worked live (field bug 2026-06-27,
  recordings `64c6a294` / `e7431b85`). The listener is only registered when at
  least one opt-in is requested (zero per-action overhead otherwise). Consumers
  asserting the flag after `setZeroPos` must `await` the async effect first (see
  the tests). The five boolean opt-ins are built from a **declarative row table**
  (options flag → `gpsData` field → library setter action) whose `flag` column is
  typed `BooleanCompassFlagField` (the boolean-typed keys of `gpsData`), so a
  typo'd or wrong-typed field name fails to compile; adding a compass toggle
  means adding one row plus its option/doc. The value-carrying `compassVoteWeight`
  stays a hand-written opt-in because it is a number and so cannot satisfy
  `BooleanCompassFlagField` — but it follows the same `isSet` rule as the rows
  ("decided", i.e. `!== undefined`) and dispatches its value. See
  [`GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-plan.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-0751-subscriber-dispatch-persistence-ordering-plan.md).
- The factory does **not** know about routing, ref-points, or scenarios. Any
  app needing those plugs them in via `extraReducers`.

## Examples

```ts
// Minimal generic AR+GPS app — no recorder slices.
import {
  createSlamAppStore,
  NullStorageBackend,
} from 'gps-plus-slam-app-framework/state';

const store = createSlamAppStore({ storageBackend: new NullStorageBackend() });
store.getState().gpsData; // library state, ready to use
```

```ts
// Recorder-flavoured composition (target shape after Iter 1D).
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { routingReducer } from './recorder-state/routing-slice';
import { scenarioReducer } from './recorder-state/scenario-slice';
import { refPointsReducer } from 'gps-plus-slam-app-framework/state';

const store = createSlamAppStore({
  storageBackend,
  extraReducers: {
    routing: routingReducer,
    scenario: scenarioReducer,
    refPoints: refPointsReducer,
  },
});
```

## Tests

Covered by [create-slam-app-store.test.ts](create-slam-app-store.test.ts):

- Base state shape contains library reducers + `recorder`.
- Routing / refPoints / scenario are absent unless supplied as extras.
- `startSession` / `endSession` flow through the recording slice.
- `extraReducers` mount under their slice keys and accept their actions.
- `extraMiddleware` runs alongside the persistence middleware.
- `writeFrame` / `writeSessionMetadata` route through the supplied backend.
- `flushPendingActionWrites` routes to the persistence middleware's `flushPendingWrites` (resolves when every queued action write settled; immediate when idle; never hangs on rejected writes).
- Empty / invalid license keys throw at construction.
