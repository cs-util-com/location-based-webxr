# globe-sun.ts - the sun's direction for the globe

- Purpose: globe plan 2026-09-26-0539 §7.3, M3 (DEC-PRG-13, the real sun).
  Turns the framework's `solarPosition(ms, 0, 0)` (elevation and azimuth
  seen at 0°N 0°E) into a unit ECEF direction. The sun is 1 AU away, so the
  place it is observed from changes the direction by under 0.01°.
- Public API: `sunDirectionEcef(ellipsoid, { elevationRad, azimuthRad })`
  returns a `THREE.Vector3` (unit, ECEF, z north), through the ellipsoid's
  east-north-up axes at 0°N 0°E. Azimuth is clockwise from north, as
  `SolarPosition` gives it. RangeError for a non-finite angle.
- Reuse: no second solar formula; the lab imports `solarPosition` from
  `/fw/geo/solar-position.js` and passes its result here.
- Tests: `globe-sun.test.ts` (the zenith and the east and north horizons
  onto +x, +y, +z; unit length and height above the horizon for any
  angles; non-finite refused). The browser: the lab smoke's day side at the
  subsolar point.
