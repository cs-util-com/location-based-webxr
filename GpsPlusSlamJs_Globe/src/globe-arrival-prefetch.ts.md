# globe-arrival-prefetch.ts

- Purpose: the arrival prefetch (round-5 plan 2026-10-01-0945 §3.6 step
  1): the city's own load for the flight's place, which the approach waits
  for (it paces the dive and opens the continuous flight's gate), and its
  status line. Moved out of the globe lab's pin (`bindPin`) as a pure
  refactor (editor-on-the-full-globe plan, the approach slice).
- Public API: `createArrivalPrefetch({ startCityLoad, show, manualDive })`:
  - `start(target, { prefetch, diveMs })`: stops the last; with `prefetch`
    not 0 starts `startCityLoad(target)` (null: nothing to load, outcome
    `off`); returns the dive's clock `(elapsedMs) => number`
    (`createDiveClock`: paced on the progress, or fixed when off or when
    `manualDive()`, `diveMs` set in the hash);
  - `stop()`: aborts a load still running (outcome `aborted`), once;
  - `progress()`: 0 before a flight, 1 when off or with nothing to load,
    else the load's;
  - `render()`: writes the status line through `show` only when its text
    changed (`arrivalStatusText`; "" when off);
  - `state()`: null before a flight, else `{ outcome, progress, counts,
paced, rate, line }` (the lab's `pin.state().arrival`).
- Invariants & assumptions:
  - A load's late outcome is taken only by its own flight, and only while
    that flight has none (stopped first: `aborted` stays).
  - `manualDive()` is read at each start, as the lab read the hash.
  - `createDiveClock` throws `RangeError` for a `diveMs` that is not a
    positive number (the lab's hash clamps it).
- Example:
  ```ts
  const arrival = createArrivalPrefetch({
    startCityLoad: (t) => cityStep?.warmUp(t, { zoom, law }) ?? null,
    show: (text) => {
      line.textContent = text;
      line.hidden = text === "";
    },
    manualDive: () => new URLSearchParams(location.hash.slice(1)).has("diveMs"),
  });
  const clock = arrival.start(place, params);
  ```
- Tests: `globe-arrival-prefetch.test.ts` (recording fakes: loads
  started, aborts and lines written in order; paced and fixed clocks;
  off; nothing to load; stop; a superseded load's late outcome).
