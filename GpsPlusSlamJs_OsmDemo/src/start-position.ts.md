# `src/start-position.ts`

## Purpose

Parses the demo's start-position override: `?lat=&lng=` or `?site=<id>`.

## Public API

- `parseStartPosition(search: string): LatLng`
- `DEFAULT_START` — Manhattan at the Central Park edge, taken from `PICKER_PLACES[0]` (DEC-R6b-3)

## Invariants & assumptions

- **`Number('')` is `0`, not `NaN`.** This is the whole reason the function
  checks emptiness _before_ finiteness. The README advertises the literal form
  `?lat=&lng=`, which is a present-but-empty pair: it passes `Number.isFinite`,
  passes the range check, and opened the demo at 0°N 0°E — a point in the Gulf
  of Guinea with no OSM data, which reads as "the demo is broken" rather than
  "your URL was empty". `Number(' ')` is `0` too, so trimming has to happen
  before the numeric conversion rather than being left to it.
- **Both parameters are required together.** A half override (`?lat=51&lng=`)
  used to yield `{lat: 51, lng: 0}` — the right latitude on the Greenwich
  meridian, which is a more convincing wrong answer than Null Island.
- **`0` is a legitimate coordinate.** The check rejects EMPTY, never falsy.
- **It takes a `string`, not `window.location`.** That is what makes every
  rejection branch testable without a browser — see below.

## Examples

```ts
const start = parseStartPosition(window.location.search);
```

## Tests

`start-position.test.ts` — the valid cases, both Null Island forms, the
half-empty pair, and the absent / non-numeric / out-of-range branches.

**Why this module exists at all:** it began as a helper inside `main.ts`, which
is DOM wiring and has no unit tests, while the e2e suite only ever passes a
valid pair through `AT_FIXTURE`. Every guard was therefore unreachable by the
gate — the whole thing could have been deleted and everything stayed green.
Extracting a pure `string → LatLng` is what made the bug findable.
