# validate-option-fields.ts

## Purpose

The framework's one primitive for validating a **persisted options group**: a declarative spec table per group instead of a hand-rolled per-field validator. Used by every module that owns a config type a consumer app persists and reloads.

## Public API

- `validateOptionFields<T>(options, defaults, specs): T`
  - `options: Partial<T> | null | undefined` — untrusted input (nullish = "nothing set", yields the full defaults).
  - `defaults: T` — the group's defaults; every rejected field falls back here.
  - `specs: GroupSpec<T>` — one rule per field.
  - Never throws, never returns a field the spec did not accept.
- `type FieldSpec<T, K>` — the four rule kinds:
  - `{ kind: 'bool' }` — only a real boolean is accepted.
  - `{ kind: 'num', constraint: { min, max }, round? }` — only a **finite** number is accepted (a persisted `NaN` is `typeof 'number'` and would survive a bare clamp), optionally rounded to an integer, then clamped.
  - `{ kind: 'enum', values }` — membership test against `values`.
  - `{ kind: 'custom', resolve(options, fallback) }` — legacy migrations and nested groups; receives the whole raw group.
- `type GroupSpec<T>` — `{ [K in keyof T]-?: FieldSpec<T, K> }`.

## Invariants & assumptions

- **Exhaustive by construction.** `GroupSpec<T>` requires a rule for every field of `T` (including optional ones, via `-?`), so adding a field to an options interface is a **compile error** until its validation is declared. This is the property the hand-rolled validators could not offer — a new field was simply dropped.
- **Key order follows the SPEC, not the input.** The result object is built by iterating `Object.keys(specs)`, so a group's serialized JSON is byte-stable across save→validate round-trips. Declare specs in the same order as the group's defaults.
- **Defaults are read, never mutated or aliased**, except by a `custom` resolver that chooses to return its `fallback` reference — pass a fresh object from such resolvers if the caller mutates the result in place.
- The `as` casts inside the switch are deliberate and contained: TypeScript cannot correlate `T[K]` with the matched spec kind inside a generic loop. Call sites stay fully typed through `GroupSpec`.

## Examples

```ts
import {
  validateOptionFields,
  type GroupSpec,
} from '../utils/validate-option-fields.js';

interface GateConfig {
  enabled: boolean;
  threshold: number;
}
const DEFAULTS: GateConfig = { enabled: true, threshold: 0.5 };
const SPEC: GroupSpec<GateConfig> = {
  enabled: { kind: 'bool' },
  threshold: { kind: 'num', constraint: { min: 0.05, max: 0.95 } },
};

validateOptionFields({ threshold: NaN }, DEFAULTS, SPEC);
// → { enabled: true, threshold: 0.5 }
```

## Tests

- `validate-option-fields.test.ts` — one case per rule kind plus the cross-cutting invariants: nullish input yields the defaults, `NaN`/`Infinity` fall back rather than clamp, `round` applies before clamping, unknown enum members fall back, and the output key order follows the spec.
- Indirect coverage from the three owners that use it: `ar/capture-motion-gate.test.ts`, `ar/image-quality.test.ts`, `ar/ar-crash-isolation.test.ts`, and the recorder's `state/recording-options.test.ts` / `.property.test.ts` (fast-check junk-input properties over every group).
