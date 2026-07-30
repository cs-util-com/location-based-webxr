# `ref-points-slice.ts`

## Purpose

Flat Redux slice owning all reference-point entries in the recorder app.
Each `RefPointEntry` is either a live observation (a "Capture" tap) or an
imported known landmark (from the OPFS sidecar fast-path).

The slice is the recorder-side replacement for the library's
`gpsData.referencePoints` field + the legacy recorder `refPoints` slice.
It is registered alongside the legacy slice under a parallel root key
(`refPoints`) and is **pure addition** until sub-step 5.7 of the
[slice-collapse plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-27-collapse-refpoint-and-frame-slices-plan.md)
collapses the two.

## Public API

| Symbol                                           | Kind     | Description                                                                                                                                                               |
| ------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RefPointEntry`                                  | type     | One entry: `{ id, timestamp, name?, rawGpsPoint, gpsPoint? }`.                                                                                                            |
| `RefPointsState`                                 | type     | `{ entries: RefPointEntry[] }`.                                                                                                                                           |
| `refPointsReducer`                               | reducer  | Mounted at `state.refPoints`.                                                                                                                                             |
| `addRefPointEntry(entry)`                        | action   | Appends a single entry.                                                                                                                                                   |
| `setImportedRefPointEntries(entries)`            | action   | Replaces the array wholesale (sidecar startup fast-path).                                                                                                                 |
| `resetRefPoints()`                               | action   | Restores empty initial state.                                                                                                                                             |
| `selectRefPointEntries(state)`                   | selector | Memoised; returns a stable empty sentinel when no entries.                                                                                                                |
| `selectKnownAnchorsByCell(state)`                | selector | Memoised; groups by H3 cell `id`; first-non-null `name` per cell wins.                                                                                                    |
| `selectImportedKnownAnchors(state)`              | selector | Memoised; filters entries by `timestamp === 0` (sidecar imports) and maps to `KnownGeoAnchor[]`. Mirrors the legacy `selectCachedKnownRefPoints` output (Option C, §A.6). |
| `countEntriesByCellInSession(state, start, end)` | helper   | `Map<id, count>` filtered by inclusive timestamp range.                                                                                                                   |

## Invariants

- Multiple entries can share the same `id` (H3 cell). Grouping happens
  only in selectors, never in state.
- `rawGpsPoint` is always present. `gpsPoint` is optional — absent for
  imported entries and for legacy entries replayed from pre-Step-1
  recordings. When present it carries the fused lat/lon (+altitude)
  snapshot in `RawGpsPoint` shape — the visualizer reads only those
  three fields, so storing the slim raw shape avoids re-deriving the
  full state-side `GpsPoint`.
- Reducers never mutate entries in-place; they only push or replace the
  array.

## Tests

- [ref-points-slice.test.ts](ref-points-slice.test.ts) — reducer
  cases (`addRefPointEntry`, `setImportedRefPointEntries`,
  `resetRefPoints`) and action-type namespace assertions.
- [ref-points-v2-selectors.test.ts](ref-points-v2-selectors.test.ts) —
  `selectRefPointEntries` (incl. stable empty sentinel),
  `selectKnownAnchorsByCell` (grouping, first-non-null name, lat/lon
  surface, memoisation), `selectImportedKnownAnchors` (timestamp-0
  filter, displayName fallback, memoisation, stable empty sentinel),
  and `countEntriesByCellInSession` (inclusive range filtering).
