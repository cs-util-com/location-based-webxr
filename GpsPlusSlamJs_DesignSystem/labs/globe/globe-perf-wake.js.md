# labs/globe/globe-perf-wake.js - keeps the screen on through a sweep

- Purpose: a fixed-view sweep runs for many minutes untouched; a phone
  that dims or locks its screen hides the page, which voids the run in
  progress and throttles the rest. The recorder (`globe-perf.js`) holds a
  Screen Wake Lock for the sweep and records whether it held, so a tester
  and the export both know.
- Public API:
  - `createWakeKeeper({ wakeLock, doc })` -> `{ start(), stop(), report() }`:
    - `wakeLock` the page's `navigator.wakeLock` (undefined where the API
      is missing), `doc` its `document`;
    - `start()` (async) requests a `screen` lock and listens for the page
      becoming visible again; a lock the browser released (the page was
      hidden) is requested again then;
    - `stop()` releases the lock and stops listening;
    - `report()` -> `{ supported, held, everHeld, requests, refused, lost,
reacquired, heldThroughout }`: `refused` at most 10 `"Name:
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
  after a loss, a refusal recorded, unsupported, at most 10 refusals).
