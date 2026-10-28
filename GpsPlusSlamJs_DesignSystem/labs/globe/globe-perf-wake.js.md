# labs/globe/globe-perf-wake.js - keeps the screen on through a sweep

- Purpose: a fixed-view sweep runs for many minutes untouched; a phone
  that dims or locks its screen hides the page, which voids the run in
  progress and throttles the rest. The recorder (`globe-perf.js`) holds a
  Screen Wake Lock for the sweep and records whether it held, so a tester
  and the export both know.
- Public API:
  - `createWakeKeeper({ wakeLock, doc, onChange, startTimeoutMs = 3000 })`
    -> `{ start(), stop(), report() }`:
    - `wakeLock` the page's `navigator.wakeLock` (undefined where the API
      is missing), `doc` its `document`, `onChange(held)` told each
      time the lock is taken or lost (the recorder's status line);
    - `start()` (async) requests a `screen` lock and listens for the page
      becoming visible again; it waits at most `startTimeoutMs` for the
      request (a request that never settles must not hold the sweep), and
      a late answer still counts. A lock the browser released is asked
      for again at once while the page is visible, else when it is
      visible again; never two requests in flight;
    - `stop()` releases the lock and stops listening;
    - `report()` -> `{ supported, held, everHeld, requests, refused, lost,
reacquired, heldThroughout, startTimedOut }`: `refused` at most 10 `"Name:
message"` strings, `lost` the releases the page did not ask for,
      `heldThroughout` held from the start with no loss.
- Invariants & assumptions:
  - Never throws: a refusal (no user gesture, a battery saver, an
    insecure context) is recorded, and the sweep runs on.
  - A lost lock does not by itself void a run; the hidden page that
    caused it does (the recorder's `hidden` event).
- Examples: `const wake = createWakeKeeper({ wakeLock: navigator.wakeLock,
doc: document }); await wake.start(); ... wake.stop(); wake.report();`
- Tests: `globe-perf-wake.test.mjs` (held and released, re-acquired
  after a loss, asked for again at once while visible, never two
  requests in flight, the start's timeout, a refusal recorded,
  unsupported, at most 10 refusals).
