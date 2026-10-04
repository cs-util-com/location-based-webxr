# station-run.ts

## Purpose

The visitor's station run (tour kit plan K4, §4.2, §8 D5): each station's
state, which stations the order preset offers, the labelled "skip, I can't
get there", and when to suggest it. Pure; the caller supplies the clock,
the distances, the code locks and the scene ends. Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `createStationRun({ stations, order, nowMs }): StationRun`
  - `offered()` - the offered station ids, in list order; empty once
    complete.
  - `status(id)` / `statuses()` - `{ id, state, skipped, foundVia,
focusedAtMs, focusDistanceM }`.
  - `isComplete()`.
  - `observe({ distances, accuracyM, nowMs }): StationEvent[]` - horizontal
    distances to the stations the caller can place; no judgement at all on
    a missing accuracy or one above `ACCURACY_CEILING_M`.
  - `codeLocked(levelId, nowMs)` - a lock of a code the viewer trusts (the
    caller filters the moved-code check's ignored codes, D20).
  - `finish(id, nowMs)` - the scene ended (found stations only).
  - `skip(id, nowMs)` - any offered station not done.
  - `skipSuggested(id, nowMs)` - an offered, unfound station whose clock ran
    out.
  - `focus(id, nowMs, distanceM)` - the station the guide points at: its
    skip clock starts at the first call, with the distance then (else the
    first observed after) - K4 review R14, the clock used to start at the
    offer, which under `any` order is the tour's start;
  - `unskip(id, nowMs)` - undo a skip: the station waits again, unskipped,
    with a fresh clock, offered as before the skip (branch order makes it
    the current station again); a station not skipped: nothing;
  - `upcoming()` - under `fixed` or `branch` order, while the one offered
    station is found: the station offered once it is done (the prefetch
    reads it ahead, K4 review R5); null otherwise and always under `any`.
- `StationEvent`: `found` (`via: gps | code`),
  `done` (`skipped`), `offered` (the full new set), `complete`.
- `stationTitle(station)` - the station's title, or "the next station".
- `skipSuggestAfterMs(focusDistanceM)`, `SKIP_SUGGEST_BASE_MS` (2 min),
  `SKIP_SUGGEST_SLOW_MPS` (0.5 m/s).

## Invariants & assumptions

- **States:** waiting -> found (inside `foundM`, or the station's own code
  locked from any distance) -> done (`finish` or `skip`); found and done
  never revert. There is no "active" state (K4 review R10): the K4 build's
  one, with its own hysteresis on the activation radius, drove nothing a
  visitor sees; the activation radius now only sets where the prefetch
  starts.
- **Only offered stations change.** Under `fixed` order a later station is
  not found by walking past it, nor by its code.
- **Order presets:**
  - `fixed` - the first station not done, in list order;
  - `any` - every station not done;
  - `branch` - one station at a time, starting with the first: after a
    station is done, its `next`, else its list successor; a target already
    done falls through to the first undone station after it in list order;
    the path ends when nothing follows. Stations off the path stay unvisited
    (plan §7's open question; answer routes are K5's).
- **No deadlock (§8 D5):** each completion reduces the undone stations by
  one, every offered station can be skipped, and the next offer is computed
  from the list, never from a cycle; property-tested over generated tours
  with cyclic `next` links.
- **A station with no steps** (all left out for a newer minor, K1 review R4)
  is done the moment it is found.
- **The skip clock** starts when the station becomes the guide's focus
  (`focus`; K4 review R14) and scales with the distance then: 2 minutes
  plus 1 s per 0.5 m. Under `fixed` and `branch` order the focus is the
  offered station, so the clock starts with the offer as before.
  The skip itself is offered on demand from the start; the clock only
  decides when it is suggested (`station-run.sweep.test.ts`).

## Examples

```ts
const run = createStationRun({ stations, order: "fixed", nowMs: Date.now() });
run.observe({ distances: new Map([["gate", 4]]), accuracyM: 5, nowMs });
// [{ kind: "activated", id: "gate" }, { kind: "found", id: "gate", via: "gps" }]
run.finish("gate", nowMs); // done, the next station offered
```

## Tests

- `station-run.test.ts` - each transition, the hysteresis, the accuracy
  ceiling, the code lock, the empty station, each order preset, the skip,
  the suggestion clock; properties: no deadlock and completion within one
  action per station for every preset, a done station never offered and
  never changed.
- `station-run.sweep.test.ts` - the suggestion clock over distance, speed,
  detour and set-off time.
