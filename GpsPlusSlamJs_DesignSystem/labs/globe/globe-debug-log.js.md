# globe-debug-log.js

- Purpose: the globe lab's event log and its export for the Debug panel
  (round-6 plan 2026-10-04-1050 G6-0, DEC-G6-6). The owner reports in audio
  what the phone showed and pastes this export, so a report can be checked
  against what the page did.
- Public API:
  - `createDebugLog({ capacity = 500, now })` -> `{ log(kind, detail),
entries(), total() }`: a ring of the newest `capacity` events, each
    `{ t, kind, detail }` (`t` from `now`, ms; `detail` any JSON-able value,
    null when absent). `entries()` is oldest first; `total()` counts every
    event ever logged. RangeError for a capacity that is not a positive
    integer, or an empty kind.
  - `debugExportText({ device, live, recording, events, link })` -> the
    export as JSON text, tagged `format: "globe-debug/1"`, `link` (a URL
    or null) right after the tag; a non-finite number is
    written as its name ("NaN", "Infinity"), never silently as null.
- Invariants: bounded memory whatever the session's length; a full ring of
  500 events exports under 100 KB (tested). Dependency-free (`node --test`).
- What the lab logs: errors (`error`, `console.error`, which carries
  three's shader errors), band edges and the band share in steps of 0.1,
  carrier releases and their end (`drained.*`), E steps with their time,
  and the panel's recording start and stop.
- Tests: `globe-debug-log.test.mjs` (order and detail, the ring, refusals,
  the non-finite numbers, the size bound); the fast tier's globe test
  checks a real export.
