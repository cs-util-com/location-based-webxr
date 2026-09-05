# main-module-stubs.ts

## Purpose

Test-only. The 22 `vi.mock` statements that every `main.*-wiring.test.ts` suite needs and none of them asserts on, in one place. Until 2026-09-04 each of the seven suites carried a byte-identical ~130-line copy, and every new wiring suite started by copying it — the pattern this module stops.

## Public API

None. Importing the module for its side effect registers the stubs:

```ts
import { describe, it, expect, vi } from 'vitest';
import './test-utils/main-module-stubs'; // FIRST, before ./main is imported
```

## Invariants & assumptions

- **Order.** `vi.mock` registers against the RESOLVED module path and applies to whatever is imported afterwards, so this module must be evaluated before the suite imports `./main` (statically or via `await import('./main')`). Placing the import directly after the vitest import satisfies that in every suite.
- **A suite's own `vi.mock` for the same path wins** — its hoisted call runs after this module's. That is how a suite gives one of these modules a shape it asserts on.
- **Nothing here is asserted on.** The mocks a suite inspects (`webxr-session`, `recorder-store`, `recording-options`, the visualizers) stay in that suite, next to the hoisted spies they reference.
- Relative specifiers are rooted at `src/test-utils/` (`'../ui/hud'`), which resolves to the same module as a suite's `'./ui/hud'`.

## Tests

Exercised by all seven `main.*-wiring.test.ts` suites (56 tests); a stub that stopped matching `main.ts`'s imports would surface there as an unmocked side effect.
