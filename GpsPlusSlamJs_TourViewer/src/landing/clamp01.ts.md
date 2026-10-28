# landing/clamp01.ts

## Purpose

The Tour Viewer's one `clamp01`: clamps a number into `[0, 1]`, for the
landing's intersection shares and timeline fractions.

## Public API

- `clamp01(value: number): number` - total, never throws. In range:
  unchanged; below 0: 0; above 1: 1; non-finite (`NaN`, `±Infinity`): 0.

## Invariants & assumptions

- A deliberate copy of the framework's `utils/clamp01.ts`, same contract
  (a pure one-liner may exist once per package). The
  framework's module is no deep-import entry of its build; making it one
  would put every dependent of the framework behind a Tour Viewer change.
  `tests/repo-config/duplicate-helpers.test.js` holds the package to one
  copy; `clamp01.test.ts` restates the contract (the framework's module is
  not reachable from a test here).
- Non-finite reads as 0: a share the browser could not compute means
  "nothing known in view", never "fully in view".

## Examples

```ts
clamp01(entry.intersectionRatio / Math.min(1, innerHeight / height));
```

## Tests

- `clamp01.test.ts` - fixed cases, and a property of the contract.
