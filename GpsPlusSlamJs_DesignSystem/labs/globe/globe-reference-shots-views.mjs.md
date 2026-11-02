# globe-reference-shots-views.mjs

- Purpose: the views the globe's reference capture
  (`globe-reference-shots.smoke.spec.mjs`) added after its first seven, at
  the altitudes where the cloud shell volume's look lives, and the search
  for the dive time at which the reference flight passes an altitude. The
  first capture looked at 300 km and 30 km only, so a change of the cloud
  layers between them (the shell's stations, the flat layer's fade) showed
  in no view.
- Public API:
  - `BAND_VIEWS`: held views over the reference place, heading 0 and
    pitch -25: `8-shell-band-120km` (120 km), `9-shell-band-60km` (60 km),
    `10-shell-band-20km` (20 km).
  - `FLIGHT_HOLDS`: the reference flight held with the lab's `holdDiveAt`
    where it passes 120, 60 and 20 km: `11-flight-120km`,
    `12-flight-60km`, `13-flight-20km` (the flight's own camera pose, which
    no held view takes).
  - `ADDED_SHOT_NAMES`: the six names in capture order; the compare script
    compares them where both captures hold them.
  - `diveTimeFor(altitudeAt, targetM, { startMs = 1000, maxMs = 3600000, steps = 40 })`:
    the first dive time (ms on the flight's own clock) at which the
    altitude is at or below `targetM`, as `{ ms, altitudeM }`. `altitudeAt`
    is the lab's `diveAltitudeAt` through the page (a promise or a number).
    The time doubles until the flight is below the target, then `steps`
    halvings narrow it. Errors: RangeError for a target that is not finite
    or negative, or a flight still above the target at `maxMs`; Error when
    `altitudeAt` answers anything but a finite number (no flight).
- Invariants: the names never reuse one of the first seven, so captures
  made before these views still compare. The dive time is on the flight's
  own clock, so two builds hold the flight at the same time and their
  shots differ only by the code. A flight that climbs before it dives is
  found on the way down as long as it is above the target at every
  doubling before.
- Example (the capture):

  ```js
  const altitudeAt = (ms) =>
    page.evaluate((t) => window.__globeLab.diveAltitudeAt(t), ms);
  const { ms } = await diveTimeFor(altitudeAt, 60_000);
  await page.evaluate((t) => window.__globeLab.holdDiveAt(t), ms);
  ```

- Tests: `globe-reference-shots-views.test.mjs` (the names numbered after
  the first seven and unique, the altitudes and pitch; the search on a
  linear dive, through promises, from below, on a flight that climbs
  first, and its refusals).
