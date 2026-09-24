# Real Sun Data Adapter

Creates independent location/time selection state around the existing
`calculateSunPosition` core. Import `createRealSunDataAdapter` and its types from
`gps-plus-slam-app-framework/geo` or `/geo/real-sun-data-adapter`.

## Inputs and ownership

Default sources are live geographic location and the current device wall clock.
Forward the existing framework `GpsPosition` callback to `setGpsPosition`.
The adapter never starts/stops GPS, requests permissions, owns timers, or renders.
The host schedules `refresh()` (for example every 30 seconds in real-time mode)
and disposes the adapter at session end.

`setLocationSource` and `setTimeSource` change one selection without changing the
other. Both live/fixed location and real/fixed time can be combined independently.
Use `setInputs` for atomic location/time pairs, especially recorded replay frames:

```ts
const adapter = createRealSunDataAdapter();
adapter.setInputs({
  location: { mode: 'fixed', latitudeDeg: 51.05, longitudeDeg: 13.74 },
  time: { mode: 'fixed', instant: new Date('2026-07-12T10:15:30Z') },
});
```

Fixed Dates are copied as epoch milliseconds. No timezone arithmetic is applied;
manual text parsing belongs to the host and should require an explicit offset.
`now` is an optional injectable real clock, unused in fixed-time mode.
`sunTimeMs` is the instant passed to the core; `locationTimestampMs` is the live
fix time, optional fixed-location `recordedAtMs`, or null for manual coordinates.

## State and updates

- `waiting-for-location`: no live fix. Fixed location needs no live fix.
- `ready`: immutable sample containing source metadata and the unmodified core
  result fields. Negative altitude/direction and horizon status are preserved.
- `invalid-input`: invalid selected location or time, with no previous ready
  sample exposed. Location errors take precedence over time errors.
- `disposed`: terminal state. All later writes/refreshes are inert.

Coordinates must be finite and in latitude [-90, 90], longitude [-180, 180].
Timestamps must be finite and Date-representable. Auxiliary GPS fields do not
gate calculation. There is no implicit accuracy threshold or stale-fix expiry.

Live updates replace the cached fix even during fixed location, without publishing
or recalculating fixed output. Invalid live data clears the old fix and records an
error; switching back to live exposes it until recovery/clear. Invalid fixed data
never falls back to live/current input. A valid replacement recovers; real-clock
errors also recover on a later valid refresh.

Each successful refresh/source change calculates once and publishes once, even
for unchanged inputs. `subscribe` observes future publications, isolates listener
exceptions, and returns an idempotent unsubscribe function. Read initial state
with `getState`. Do not synchronously change inputs from subscribers: nested
notifications follow the framework registry's synchronous dispatch semantics.

`getInputs` returns defensive copies, including fresh Date objects.
`clearLiveLocation` clears only the cached live fix/error, leaving fixed selections
intact. Full reset is dispose-and-recreate. `dispose` notifies once, releases
listeners/live data and retains the last selection for inspection.

## Validation and limits

The colocated production tests cover selection, absolute time, delegation,
synthetic replay, validation, snapshots, subscriptions and disposal.
Task 1 recording loading/ordering, outdoor e2e validation, manual UI, and sun
disc/lighting/shadow integration remain separate work. Runtime values outside
the typed source shapes (such as a null source object) are not a supported API.
