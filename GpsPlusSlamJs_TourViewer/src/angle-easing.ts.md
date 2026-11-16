# angle-easing.ts

## Purpose

Angles the short way round, the package's one copy: wrap an angle into (-pi, pi], and ease one angle toward another along the shorter turn.

## Public API

- `wrapAngle(a)` - `a` in radians wrapped into (-pi, pi] (`atan2(sin a, cos a)`); NaN stays NaN.
- `easeAngle(from, to, k)` - `from + wrapAngle(to - from) * k`: `k` 0 keeps `from`, 1 reaches `to` (or an angle a whole turn from it). Not wrapped, so a turn that keeps easing stays continuous.

## Invariants

- The eased step never exceeds pi in size: an angle just past pi from `from` is reached the short way, never by a near-full spin.
- Pair `k` with `smoothingAlpha` (`surface-smoothing.ts`) for frame-rate independent easing.

## Users

`kinds/short-text/sign.ts` (the turn and the glyph), `code-visit-combine.ts` (yaw offsets). The character files keep their own copy, outside this module's reach.

## Tests

`angle-easing.property.test.ts`: the wrap's range and its sameness modulo a turn, the short way, the ends of `k`.
