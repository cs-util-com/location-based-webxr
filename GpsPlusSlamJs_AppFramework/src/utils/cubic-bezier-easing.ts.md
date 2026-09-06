# `cubic-bezier-easing.ts`

- Purpose: CSS `cubic-bezier(x1, y1, x2, y2)` timing functions evaluated as
  a browser does (solve the parametric curve's x for the parameter, read y).
  Exists so the wayfinding HUD's diamond entrance follows the design
  system's `--ease-out: cubic-bezier(0, 0, 0.2, 1)` exactly rather than a
  look-alike `easeOutCubic`. Plan:
  [2026-09-05-2138 HUD diamond entrance animation](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-05-2138-hud-diamond-entrance-animation-plan.md)
  §2 and M1.
- Public API:
  - `cubicBezierEasing(x1, y1, x2, y2): EasingFunction` - builds the timing
    function. `x1`, `x2` must be finite and within [0, 1] (CSS requires it;
    it is what makes the curve a function of x); `y1`, `y2` finite, any
    value (overshoot is legal CSS). Throws `RangeError` at build time
    otherwise, never per call.
  - `EasingFunction = (x: number) => number` - clamps its input with the
    canonical `clamp01` (below 0 → 0, above 1 → 1, non-finite → 0), returns
    y at the parameter whose x equals the input. Endpoints exact: 0 → 0,
    1 → 1.
  - `EASE_OUT` - the design system's `--ease-out`, `cubicBezierEasing(0, 0,
0.2, 1)`.
- Invariants & assumptions:
  - The inverse x → u is a bisection (≤ 52 halvings, stop at a 1e-12
    residual); monotone because the control x are in [0, 1]. Pinned value:
    `EASE_OUT(0.5) = 0.839245` (u = 0.746017), from the plan's spike.
  - Deep import only (`gps-plus-slam-app-framework/utils/cubic-bezier-easing`),
    not on the `/utils` barrel - one curve must not drag the logger in. A
    per-file tsdown entry advertises the subpath.
  - SHARED behaviour under DEC-H3: a `shared` CANONICAL entry in the webxr
    root's `tests/repo-config/duplicate-helpers.test.js` stops a second
    named copy.
- Example:

  ```ts
  import { EASE_OUT } from 'gps-plus-slam-app-framework/utils/cubic-bezier-easing';
  const drawn = EASE_OUT(elapsedMs / 800); // the outline's drawn fraction
  ```

- Tests: `cubic-bezier-easing.test.ts` (the pinned midpoint and exact
  endpoints of `EASE_OUT`, the identity for linear control points, the
  ease-out direction near 0, input clamping, the rejected control points);
  `cubic-bezier-easing.property.test.ts` (fast-check: monotone in x for any
  control points, exact endpoints, outputs inside [0, 1] when the control y
  are, the inverse verified against the forward polynomial through the
  identity-like curve).
