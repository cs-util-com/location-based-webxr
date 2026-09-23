# atmosphere-exposure.ts

## Purpose

Exposure for a physical sky. Measures the illuminance on a horizontal
surface (direct sun + the sky's irradiance integrated from the sky-view LUT)
and picks the exposure a partially adapting camera would. Added after the
first look-dev screenshots (2026-09-23): daylight spans ~6 orders of
magnitude between noon and blue hour, and no fixed exposure worked for any
two presets.

## Public API

- `AUTO_EXPOSURE` — `key` 1, `referenceIlluminance` 1 (sun-relative),
  `adaptation` α = 0.75, `minimumIlluminance` 1e-7.
- `skyIrradiance(rgba, width, height, r)` → per-channel irradiance in LUT
  units.
- `horizonAverage(rgba, width, height, r)` → the sky at dir.y =
  `horizonClampDirY` (the height the visible sky and the haze clamp to),
  blended between the two rows around it, azimuth-weighted. `r` is the
  observer radius the LUT mapping needs. Reading the row at the geometric
  horizon instead (the first version) was up to 2.8× off the drawn horizon
  at dawn and blue hour; the look-dev fallback parity smoke found it.
- `autoExposure(illuminance)` → exposure.

## Invariants & assumptions

- Irradiance sums EXACT cosine-weighted solid angles of each texel band
  (`Δa · (sin² z₁ − sin² z₀) / 2`), so a uniform sky gives π · L despite the
  LUT's quadratic spacing. Only rows above the horizon and zenith angles up
  to 90° count; the `[0, π]` azimuth range counts twice.
- Horizon columns are weighted by the azimuth they span (they are spaced as
  u², denser toward the sun).
- `autoExposure(E) = (π·key / E_ref) · (E_ref / E)^α`: a mid-grey horizontal
  surface lit by `E_ref` renders at `0.18 · key`; α < 1 keeps twilight
  darker than noon. Non-finite or tiny `E` is floored, so darkness gives a
  large finite exposure.
- Units are relative to the sun at the reference elevation; `SkyAtmosphere`
  converts.
- α is a taste parameter chosen on the look-dev page; see the plan's
  progress notes for the values tried.

## Examples

```ts
const e = luminance(skyIrradiance(lut, 192, 108, r)) * lutToRelative + direct;
atmosphere.exposure === autoExposure(e) * 2 ** compensationEv;
```

## Tests

`atmosphere-exposure.test.ts` — uniform sky integrates to π · L, rows below
the horizon ignored, constant horizon row, mid-grey anchor, partial
adaptation ratio 2^α, finite in darkness.
