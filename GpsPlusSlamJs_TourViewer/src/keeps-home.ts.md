# keeps-home.ts

## Purpose

The station rule's tolerance, by distance alone (pure): whether an item
moved near its station's circle keeps that station. The tour document asks
it in `keepsHome` (`tour-document.ts`) before the station rule seats a
moved item anew.

## Public API

- `KEEPS_HOME_TOLERANCE_M` (0.5): how far past the found radius a moved
  item still keeps its station.
- `keepsHomeDistance({ radiusM, wasM, nowM }, toleranceM?)`: true when the
  item, `wasM` from the anchor before the move and `nowM` after, keeps the
  station of found radius `radiusM`:
  - within `radiusM + toleranceM`; or
  - no farther out than before (`nowM <= wasM`): an item left outside by a
    radius lowered under it may move about out there, and back in.
  - False for a radius, a distance or a tolerance that is not a finite,
    non-negative number; a `wasM` that is no distance only loses the
    second case.

## Invariants and assumptions

- **The bound is the circle, never the previous place.** A tolerance
  measured from the previous position lets a run of small nudges creep
  outward without limit, each "only a little farther"; this rule never
  lets an item that keeps its station stand farther out than
  `max(start, radius + tolerance)`.
- The "no farther" case is strict in the sense of `<=`: an equal distance
  keeps it, a centimetre farther does not.
- `wasM` is the item's distance before the move: one move is one gesture
  (a drag commits once, a typed field once, a nudge key once), so the
  previous position is the gesture's start.
- The tour document adds what distance cannot say: the move must take the
  item into no other station's radius.
- A radius lowered under its items moves none of them (the reducer's
  `stationEdited` never seats); the inspector says how many stand outside
  the circle.

## Examples

```ts
keepsHomeDistance({ radiusM: 25, wasM: 24, nowM: 25.5 }); // true
keepsHomeDistance({ radiusM: 25, wasM: 24, nowM: 25.51 }); // false
keepsHomeDistance({ radiusM: 25, wasM: 40, nowM: 39 }); // true
```

## Tests

- `keeps-home.property.test.ts`:
  - the bound property over tolerances 0, 0.1, 0.5 and 1 m (no run of
    nudges carries an item past `max(start, radius + tolerance)`);
  - the boundary cases and the refusals of what is no distance;
  - through the reducer at 0.5 m: within the tolerance the item keeps its
    station, farther it is seated anew, and no run of nudges creeps
    outward;
  - a radius lowered under an item leaves it in its station where it
    stands (property over radii from 2 m to 300 m), and a later move
    about outside the circle keeps it, one farther out seats it.
