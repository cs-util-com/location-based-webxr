# map/core — waypoint → marker-status mapping

Pure, framework-free logic — no Leaflet, no DOM, no THREE. Same inputs → same
output.

## Public API (`map-marker-state.ts`)

```ts
computeMarkerViewModels(
  waypoints: readonly Waypoint[],
  visitedIds: readonly string[],
  nextId: string | null,
): readonly WaypointMarkerViewModel[]  // { id, position, status }
```

`status` is one of `'visited' | 'next' | 'unvisited'`:

- **`visited`** — the waypoint's id is in `visitedIds` (i.e. `tourProgress` —
  it has reached `ACTIVE` at least once, per component 4).
- **`next`** — otherwise, if it's `selectNextUnvisitedWaypoint`'s id. **A
  visual hint only, not a gate**: proximity (component 4) activates any
  waypoint by distance regardless of order — order is not enforced.
- **`unvisited`** — neither of the above.

Input order is preserved in the output.

## Tests

`map-marker-state.test.ts` — empty input, the visited/next/unvisited mix,
`nextId: null` (all visited → nobody gets `next`), and order preservation.
