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
offeredAtMs, offeredDistanceM }`.
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
- `StationEvent`: `activated`, `deactivated`, `found` (`via: gps | code`),
  `done` (`skipped`), `offered` (the full new set), `complete`.
- `skipSuggestAfterMs(offeredDistanceM)`, `SKIP_SUGGEST_BASE_MS` (2 min),
  `SKIP_SUGGEST_SLOW_MPS` (0.5 m/s).

## Invariants & assumptions

- **States:** inactive -> active (inside `activateM`) -> found (inside
  `foundM` while active, or the station's own code locked from any
  distance) -> done (`finish` or `skip`). Active falls back to inactive
  beyond `activateExitM`; found and done never revert.
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
- **The skip clock** starts when the station is offered and scales with
  the first distance observed while offered: 2 minutes plus 1 s per 0.5 m.
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
