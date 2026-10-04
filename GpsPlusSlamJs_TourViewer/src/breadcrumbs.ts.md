# breadcrumbs.ts

## Purpose

Breadcrumbs as a guide (tour kit plan K4, §8 P2; the community PR idea,
K-D4: the idea, not its implementation): a short line of dots on the ground
from the visitor towards the next station, at the scene root in the
session's GPS-world NUE. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `breadcrumbPoints({ from, to, stopM })` - the dots' NUE positions: one
  `BREADCRUMB_SPACING_M` apart, starting one spacing ahead, at most
  `BREADCRUMB_COUNT`, on the ground (`EYE_HEIGHT_M` below `from`), none
  within `stopM` of the station.
- `createBreadcrumbTrail({ getScene })` - `update(visitor, target)`: lays
  the dots again only when the visitor moved `BREADCRUMB_RELAY_M` or the
  target changed; a null visitor or target clears them.
- Constants: `BREADCRUMB_SPACING_M` (4), `BREADCRUMB_COUNT` (6),
  `EYE_HEIGHT_M` (1.5), `BREADCRUMB_RELAY_M` (1).

## Invariants & assumptions

- **The K4 build agent's choice, not the owner's:** 6 accent-coloured dots,
  4 m apart (24 m of way), 0.25 m across, flat on the ground. A visual
  choice, not swept; the owner's eye decides it.
- Straight towards the station: a tour carries no paths. They stop at the
  station's arrival band (`foundExitM`), where the station itself guides.
- One geometry and one material for the page's life; a lay replaces the
  group, never per frame.
- The target is the guide's focus (the nearest offered station not yet
  found, `station-guide.ts`); a found station, a session end or no position
  clears the trail.

## Examples

```ts
const trail = createBreadcrumbTrail({ getScene });
trail.update(visitorNue, { id: "well", to: wellNue, stopM: bands.foundExitM });
```

## Tests

- `breadcrumbs.test.ts` - the dots' spacing, ground and direction; the stop
  short of the band; a property that every dot is on the way and outside the
  band; laying again only after a metre or a new target; clearing.
- `station-guide.test.ts` - the guide's target.
