# station-run.ts

## Purpose

The visitor's station run (tour kit plan K4, §4.2, §8 D5): each station's
state, which stations the order preset offers, the labelled "skip, I can't
get there", and when to suggest it. Pure; the caller supplies the clock,
the distances and the scene ends. Plans:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` (D16: arrival
by the radius alone),
`GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md` (M1:
the rules as pure transitions, applied by the page's store).

## Public API

- **The rules as pure transitions** (W4 plan M1, §2.2): the page's store
  applies them in its `visitorWalk` reducer (`visitor-walk-slice.ts`), so
  the walk's state lives in the store and the rule once, here.
  - `type WalkProgress` - `{ order, stations, branchCurrent }`: per
    station in list order its status (`id`, `state`, `skipped`,
    `focusedAtMs`, `focusDistanceM`) and the two tour facts the rules
    read (`next`, a station of this tour or null; `stepless`); the offer
    is derived, never stored. Plain, serializable data.
  - `walkRoute(stations)` - those tour facts (`type WalkRoute`); a `next`
    naming no station of the tour is null (the list successor then).
  - `startWalk(route, order)` - every station waiting, `branch` at the
    first.
  - `applyWalkStep(progress, step): { progress, events }` - one
    `type WalkStep`: `found` (an offered waiting station; the caller
    judged the radius), `focus-distance` (the first distance of a clock
    started without one), `finish`, `skip`, `unskip`, `focus`. A step its
    rule does not allow returns the SAME progress object and no events, so
    a caller can tell an event from nothing.
  - `walkOffered(progress)`, `walkStatus(progress, id)` - the offer and
    one status, as the run reads them.
  - `stationRunOver(stations, { read, perform })` - the `StationRun`
    calls below over progress held elsewhere: `read()` the progress now,
    `perform(step)` apply one step there and return its events (the
    guide's store, `station-guide.ts`). `observe` judges each offered
    station's found radius here and performs `focus-distance` and
    `found`.
- `createStationRun({ stations, order, nowMs }): StationRun` - a thin
  adapter holding one `WalkProgress` in its closure (the run's tests, the
  sweeps, the prefetch sweep):
  - `offered()` - the offered station ids, in list order; empty once
    complete.
  - `status(id)` / `statuses()` - `{ id, state, skipped, focusedAtMs,
focusDistanceM }`.
  - `isComplete()`.
  - `observe({ distances, nowMs, precision? }): StationEvent[]` -
    horizontal distances from the phone's best position to the stations
    the caller can place (D16). A non-finite distance is not judged; the
    caller passes none without a position. `precision` is that position's
    (`PositionPrecision` of the framework's one rule,
    `gps-plus-slam-app-framework/state/position-precision`): when it is
    `tooWeak` - GPS above the ceiling, or `'none'` - nothing is judged, so
    the latch agrees with the guide's "GPS too weak to guide you" (PR #640
    review) and with its request for a code; absent, the distances are
    judged by the radius alone (callers that judge no precision). A code's
    position (`'code'`) is never too weak, whatever the raw fixes say (M5c
    review #1): being aligned alone earns no trust, since the library
    aligns a session from its first fix.
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
- `StationEvent`: `found`, `done` (`skipped`), `offered` (the full new set), `complete`.
- `stationTitle(station, number?)` - a station's name, the package's ONE
  rule for it (plan 2026-10-15-0348 M0; the editor had its own until
  then, with another fallback): the trimmed title; an untitled or blank
  one is "Station N" by its 1-based `number` where the caller knows it
  (the editor's rail, map and warnings), else "the next station" (the
  visitor's lines).
- `skipSuggestAfterMs(focusDistanceM)`, `SKIP_SUGGEST_BASE_MS` (2 min),
  `SKIP_SUGGEST_SLOW_MPS` (0.5 m/s).

## Invariants & assumptions

- **States:** waiting -> found (the distance at most the authored found
  radius, D16, which no accuracy widens; never on a position too weak to
  guide by - D16 forbids widening the radius, not refusing a fix the guide
  itself calls unusable; a code lock is no arrival - it only improves the position
  the caller measures from; no "I'm here" either) -> done (`finish` or `skip`); found and done
  never revert. There is no "active" state (K4 review R10): the K4 build's
  one, with its own hysteresis on the activation radius, drove nothing a
  visitor sees; the activation radius now only sets where the prefetch
  starts.
- **Only offered stations change.** Under `fixed` order a later station is
  not found by walking past it.
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
run.observe({ distances: new Map([["gate", 4]]), nowMs });
// [{ kind: "found", id: "gate" }] for a found radius of 4 m or more
run.finish("gate", nowMs); // done, the next station offered
```

## Tests

- `station-run.differential.property.test.ts` - random sequences of
  observe, finish, skip, unskip and focus (ids the tour lacks, non-finite
  distances and every precision included) over generated tours and the
  three orders: the same events and the same view (offer, statuses,
  completion, upcoming, suggestion) through this run - held in its
  closure, and through a store of the walk's slice - as through the
  frozen copy from before the transitions (`test-support/frozen-m1/`).
- `visitor-walk-slice.test.ts` - each step's guard through the reducer.

- `station-run.test.ts` - each transition, the radius alone (at the radius
  yes, a centimetre beyond no), non-finite distances, the empty station, each order preset (a branch
  station whose next is itself, skipped, hands on: its next is read after it is done), the skip,
  the suggestion clock; properties: no deadlock and completion within one
  action per station for every preset, a done station never offered and
  never changed; `stationTitle`: the trimmed title, "Station N" by its
  place, "the next station" without one (a blank title included).
- `station-run.sweep.test.ts` - the suggestion clock over distance, speed,
  detour and set-off time.
