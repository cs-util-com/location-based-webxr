# station-run.ts

## Purpose

The visitor's station run (tour kit plan K4, §4.2, §8 D5): each station's
state, which stations the order preset offers, the labelled "skip, I can't
get there", and when to suggest it. Pure; the caller supplies the clock,
the distances and the scene ends. Plans:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`,
`GpsPlusSlamJs_Docs/docs/2026-10-17-1816-tour-editor-3d-and-desktop-entry-plan.md` (D16: arrival
by the radius alone).

## Public API

- **The rules as pure transitions:** the page's store
  applies them in its `visitorWalk` reducer (`visitor-walk-slice.ts`), so
  the walk's state lives in the store and the rule once, here.
  - `type WalkProgress` - `{ order, stations, finished, finishWaitId }`:
    per station in list order its status (`id`, `state`, `skipped`,
    `focusedAtMs`, `focusDistanceM`) and the one tour fact the rules read
    (`stepless`); the offer is derived, never stored. Plain, serializable
    data.
  - `stationHasCard(station, assets)` - whether a station has a card to
    read without a story: a non-empty description, or a card picture whose
    asset the tour holds (`assets`, anything with `has(id)`). A picture
    naming a missing asset shows nothing, so it is no card. The one rule
    for the walk and the card (`scene-view.ts` uses it too).
  - `walkRoute(stations, assets?)` - that tour fact per station (`type
WalkRoute`, `{ id, stepless }`). Stepless means no steps AND no card
    (`stationHasCard`; no `assets`: the tour holds none): a station with a
    card keeps it until Continue (`scene-view.ts`), and that story end
    finishes it. The guide passes the open tour's assets
    (`StationTour.assets`).
  - `startWalk(route, order)` - every station waiting.
  - `applyWalkStep(progress, step): { progress, events }` - one
    `type WalkStep`: `found` (an offered waiting station; the caller
    judged the radius), `focus-distance` (the first distance of a clock
    started without one), `finish`, `skip`, `unskip`, `focus`, `left`
    (the visitor's presence at a station ended) and `finish-tour` (the
    visitor tapped "Finish the tour"). A step its
    rule does not allow returns the SAME progress object and no events, so
    a caller can tell an event from nothing.
  - `walkFinished(progress)`, `walkFinishWaitId(progress)` - whether the
    tour finished, and the station a complete tour waits on (null when
    none: not complete, or finished).
  - `walkOffered(progress)`, `walkStatus(progress, id)` - the offer and
    one status, as the run reads them. The offered list (read-only) and a
    by-id map of the stations are derived once per progress (a `WeakMap`
    on its identity: a progress is never changed, only replaced by a step
    that changes something), so a frame with nothing happening allocates
    no list and looks a station up in constant time.
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
  - `isComplete()` - every station done (nothing offered).
  - `isFinished()`, `finishWait()` - the tour finished; the station a
    complete tour waits on.
  - `left(id)` - the visitor's presence at `id` ended: finishes a
    complete tour that waits on `id`, else nothing.
  - `finishTour()` - the visitor's "Finish the tour": finishes a complete
    tour, else nothing.
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
  - `unskip(id, nowMs)` - bring a skipped station back, at any time: it waits again, unskipped, with a fresh clock, offered as
    before the skip; a station not skipped: nothing;
  - `upcoming()` - under `fixed` order, while the one offered
    station is found: the station offered once it is done (the prefetch
    reads it ahead, K4 review R5); null otherwise and always under `any`.
- `StationEvent`: `found`, `done` (`skipped`), `offered` (the full new set), `complete`, `finished`.
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
  - `any` - every station not done.
  - A tour file's `"branch"` order and a station's `next` are no longer
    part of the format: the framework's reader refuses the first at its
    own minor (reads it as `any` from a newer one) and ignores the
    second, so the walk has no path to follow.
- **No deadlock (§8 D5):** each completion reduces the undone stations by
  one, every offered station can be skipped, and the next offer is computed
  from the list; property-tested over generated tours under both
  orders.
- **A station with no steps** (all left out for a newer minor, K1 review R4)
  is done the moment it is found (under fixed order too: done is
  progress, and holding it would hold back the next offer).
- **Done is progress; finished is the visitor's:** `complete` = every
  station done, and it still
  happens at once. The tour **finishes** when it is complete AND the
  visitor's presence at the last station done ended (`left`) or they
  tapped "Finish the tour" (`finishTour`); until then `finishWaitId`
  names that station. A skip that completes the tour finishes it at
  once (a skipped station is never entered), so its step emits
  `complete` then `finished`. A station brought back unfinishes the tour
  (`finished` false, no wait); completing it again follows the same
  rules. A finished tour is never finished again.
- **The skip clock** starts when the station becomes the guide's focus
  (`focus`; K4 review R14) and scales with the distance then: 2 minutes
  plus 1 s per 0.5 m. Under `fixed` order the focus is the
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

- `visitor-walk-slice.test.ts` - each step's guard through the reducer.

- `station-run.test.ts` - each transition, the radius alone (at the radius
  yes, a centimetre beyond no), non-finite distances, the empty station, each order preset, the skip,
  the suggestion clock, a station brought back under both orders;
  finishing (completing on the last end and waiting there,
  leaving that station and not another, the tap and never before
  complete, the completing skip, a bring back, a stepless last station, a storyless
  station with a card that is not stepless, a card picture naming a
  missing asset that is no card,
  the pure reads), and a property: every tour finishes within one
  action more than it takes to complete; properties: no deadlock and
  completion within one action per station for every preset, a done station never offered and
  never changed; `stationTitle`: the trimmed title, "Station N" by its
  place, "the next station" without one (a blank title included).
- `station-run.sweep.test.ts` - the suggestion clock over distance, speed,
  detour and set-off time.
- `station-run.store.property.test.ts` - the run held in its closure
  (`createStationRun`) against the run over a store of the walk's slice
  (`stationRunOver` with the reducer): the same events and the same view
  after every call over random tours, sequences and both orders.
