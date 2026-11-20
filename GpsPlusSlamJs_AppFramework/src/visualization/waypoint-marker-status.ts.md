# waypoint-marker-status.ts

## Purpose

Pure mapping from a waypoint list + "visited" ids + a "next" hint id to a per-marker display status (`visited` | `next` | `unvisited`) a map view can render directly. Framework-free — no Leaflet, no DOM, no THREE — so it's trivially unit-testable and reusable by any map/marker view, including `flat-leaflet-map.ts`.

## Public API

### `computeMarkerViewModels(waypoints, visitedIds, nextId)`

| Param        | Type                             | Description                                              |
| ------------ | --------------------------------- | ---------------------------------------------------------- |
| `waypoints`  | `readonly MapWaypointInput[]`     | Waypoints to map (only `id` + `position` are read)         |
| `visitedIds` | `readonly string[]`               | Ids already visited                                        |
| `nextId`     | `string \| null`                  | Visual hint for the next waypoint — not an activation gate |

Returns `readonly WaypointMarkerViewModel[]`, one entry per input waypoint, same order.

### `MapWaypointInput` / `MapWaypointPosition`

Minimal structural types — `{ id: string; position: { lat: number; lon: number; altitude?: number } }`. Any richer waypoint type (e.g. an app's own tour schema) satisfies this structurally without an adapter.

## Invariants & Assumptions

- Pure function: same inputs → same output, no mutation of the input array.
- Preserves input waypoint order.
- `nextId` is a hint only — the caller decides activation order/logic separately (e.g. proximity by distance); this module never enforces waypoint sequencing.

## Examples

```ts
import { computeMarkerViewModels } from './waypoint-marker-status';

const models = computeMarkerViewModels(
  [{ id: 'wp-1', position: { lat: 49.99, lon: 8.24 } }],
  ['wp-1'],
  null,
);
// [{ id: 'wp-1', position: { lat: 49.99, lon: 8.24 }, status: 'visited' }]
```

## Tests

- `waypoint-marker-status.test.ts` — empty input, visited/next/unvisited assignment, no-next-when-null, order preservation.
