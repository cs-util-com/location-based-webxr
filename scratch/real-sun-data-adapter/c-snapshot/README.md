# C — pure snapshots and host wrapper (THROWAWAY)

Open `/c-snapshot/` using the [shared runner](../README.md).

## Design

`resolveSnapshot(snapshot)` takes source selection, a latest live fix/error and
an optional real-time value. It has no clock, cache or subscription dependency.
`createSnapshotHost(now?)` owns input copies, live caching, real-clock reads,
notifications and disposal. The panel applies immediate full selections and
provides synthetic fixture stepping.

```ts
const state = resolveSnapshot({
  selection: {
    location: { mode: 'fixed', latitudeDeg: 52.52, longitudeDeg: 13.405 },
    time: { mode: 'fixed', ms: Date.parse('2026-06-21T12:00:00Z') },
  },
  live: null,
  liveInvalid: false,
});
```

The wrapper accepts public Date inputs via `replaceSelection`, snapshotting them
as milliseconds. `acceptGps`, `refresh`, `inputs`, `read`, subscriptions and
disposal complete the host facade. The pure resolver itself accepts explicit
internal numeric snapshots; it is not the approved public API.

## Strengths

- Replay can calculate any complete frame directly, without mutable session state.
- Pure resolution is easy to exercise repeatedly and compare across seeks.
- All clock access is visible in the wrapper; fixed snapshots never need it.

## Weaknesses

- The wrapper still needs nearly all live-cache and lifecycle behavior of A/B.
- Two layers expose more concepts than the small feature currently requires.
- To avoid clock reads without valid location, this experiment first probes the
  resolver without real time, then resolves with time if needed. That repeats
  input validation in real mode (the core is still called only once).
- Pure snapshot users must know cache/error/time representation details that A
  hides. Multiple custom wrappers could drift in behavior.

## Task 1 replay fit

Excellent for explicit frame evaluation, but not necessary for deterministic
replay: A/B already support atomic fixed pairs. Prefer this architecture only if
future consumers actually need independent stateless frame resolution. Do not
promote this prototype into production.
