# globe-readout.ts - the globe's distance readout

- Purpose: round-4 plan 2026-09-28-2105 DEC-GL4-5. The owner asked to see
  the current distance in the globe's bottom text, so he can name the
  altitudes where the flight's cloud fade should start. This module turns
  the lab's numbers (the camera's altitude above the WGS84 ellipsoid, and
  during the pin's dive the camera's distance to the target's surface
  point) into one line, and throttles how often the lab writes it.
- Public API:
  - `GLOBE_READOUT.intervalMs` (250): the shortest time between two writes.
  - `formatDistance(metres)` -> text: whole km from 100 km ("20,180 km",
    en-US grouping), one decimal from 1 km ("45.6 km"), whole metres below
    ("850 m"). Negative reads "0 m"; NaN or an infinity reads "unknown"
    (it never throws: the lab calls it every frame). A deliberate second
    copy of the framework's `utils/format-distance.ts`: this package does
    not depend on the framework, and the grouping and "unknown" are not
    among that formatter's options (a justified entry in
    `tests/repo-config/duplicate-helpers.test.js`).
  - `globeReadoutText({ altitudeM, targetDistanceM })` -> "Altitude
    1,234 km", plus " · 1,300 km to the target" when `targetDistanceM` is
    not null.
  - `readoutThrottle(write)` -> `{ offer(text, nowMs) }`: calls `write`
    only for a text that differs from the last one written, and at most
    once per interval. A change inside the interval is dropped; the next
    frame's offer carries the newer value.
- Invariants & assumptions:
  - The printed number reads back as the distance within half its step
    (1 m, 100 m or 1 km): property-tested up to the Moon's distance.
  - Units switch at 999.5 m and 99,950 m, where the rounded value would
    otherwise print as "1000 m" or "100.0 km".
  - The rate: 4 writes a second. At 2 a second a 15 s dive shows 30
    values; at 10 the last digit of a descent changes faster than it can
    be read (tested bounds: 2 to 10 a second). What would reverse it: a
    phone where the write itself shows in the frame time (not measured;
    one text node, so unlikely).
- Example:

  ```ts
  const throttle = readoutThrottle((t) => (line.textContent = t));
  // every frame:
  throttle.offer(globeReadoutText({ altitudeM, targetDistanceM: null }), now);
  ```

- Tests: `globe-readout.test.ts` (units, clamps, the read-back property,
  the throttle's rate and change-only writes). The line on the page:
  `labs/globe/globe-readout.smoke.spec.mjs` in the design system.
