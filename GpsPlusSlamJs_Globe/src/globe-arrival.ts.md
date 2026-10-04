# globe-arrival.ts - the pin's arrival: its status line and its dive clock

- Purpose: round-5 plan
  `2026-10-01-0945-globe-round-5-fly-in-and-terrain-blend-plan.md` §3.6
  step 1. When the globe lab's pin dives to a place, OsmDemo's arrival
  prefetch warms that place's city data. This module gives the lab the two
  things it shows and times from it: the status line beside the pin, and
  the dive's clock (paced by the prefetch through `flight-pace.ts`, or
  fixed by `diveMs`). Pure, apart from the clock's own state.
- Public API:
  - `ArrivalJobs` `{ total, warm, fetched, failed }`, `ArrivalSnapshot`
    `{ outcome, counts: { overpass, dem } }`: the prefetch's counts,
    declared structurally (this package does not depend on OsmDemo).
    `outcome` is the prefetch's (`settled`, `aborted`,
    `no-persistent-store`, `store-unwritable`, `invalid-target`), the lab's
    `unavailable` (its module did not load), or null while it runs.
  - `arrivalStatusText(snapshot)` -> the status line:
    - while it runs: "checking what is stored" before the cache was
      listed; then the tiles warmed of the total and "cold" (with how many
      were already stored), or "already stored ... warm";
    - at the end: "ready", "ready, n failed", "already stored ... warm",
      "loading stopped", "cannot be stored here", "no city data for this
      place", or "the loader could not start".
  - `createDiveClock(mode)` -> `DiveClock` `{ paced, elapsedMs(elapsed,
progress), rate() }`:
    - `{ kind: "fixed", durationMs }`: the elapsed time as it is (the
      dive's old meaning of `diveMs`);
    - `{ kind: "paced", durationMs, pace }`: `stepPace` turns the elapsed
      time and the prefetch's progress into the path fraction `s`, and the
      clock returns `s x durationMs`, so `diveStep` keeps its own easing;
      once the pace is done it returns `durationMs` (the dive lands);
    - RangeError for a duration that is not a positive number.
- Invariants & assumptions:
  - The paced dive lands between `pace.minMs` (about 8.6 s with the
    defaults when the data is already stored) and the 30 s cap of
    DEC-GL5-6, whatever the network does: the properties of
    `flight-pace.ts`.
  - Asking the clock twice for the same instant changes nothing (the pace
    holds still when time does not advance), so a frame can read it more
    than once.
  - The status line counts Overpass and DEM tiles together ("tiles"):
    what a viewer can read in one glance; the weights live in the
    prefetch's progress, not here.
- Example: see `globe-lab.js`'s `bindPin` (`startArrival`, `renderArrival`).
- Tests: `globe-arrival.test.ts`: every status line, the fixed clock, the
  paced clock's cold start, a warm landing within a second of `minMs`, a
  landing at the cap when the data never comes, idempotence, and the
  RangeError.
