# film-math.ts

## Purpose

The few numeric helpers the hero film's story uses: a clamp to [0, 1], a
window ramp, a bump, and three easings.

## Public API

- `clamp01(v)`: clamps to [0, 1]; a non-finite value reads as 0.
- `seg(t, a, b)`: `t`'s progress through the window [a, b], clamped.
- `bump(x)`: `sin(pi x)` inside (0, 1), else 0 (a press that goes and comes back).
- `smoothEase`, `easeOut`, `backOut`: (x) => y, evaluated by the
  framework's `cubicBezierEasing`.

## Invariants

- The three easings are the prototype's polynomials written as exact cubic
  beziers (control x at 1/3 and 2/3): smoothstep is (1/3, 0, 2/3, 1), the
  ease-out cubic is (1/3, 1, 2/3, 1), and the back-out with c = 1.7 is
  (1/3, 4.7/3, 2/3, 1). The tests check each against its closed form.
- Why not the framework's `clamp01` and `smoothstep`: they are not built
  as deep-importable entries of the framework package, and the package
  already has a private `smoothstep`; one `clamp01` per package is allowed
  (`tests/repo-config/duplicate-helpers.test.js`).

## Tests

`film-math.test.ts`.
