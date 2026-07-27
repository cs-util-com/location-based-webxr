/**
 * Declarative validation for persisted option groups.
 *
 * Every options group that survives a page reload (localStorage, a recording's
 * embedded metadata, a shared URL) is UNTRUSTED input: it may predate a field,
 * carry a value from a different app version, or simply be corrupt. The rule
 * across the framework is "fall back to the group default, never throw, never
 * let a bad value reach the consumer".
 *
 * Hand-rolling that per field is where the mistakes live — a new field silently
 * skipped by the validator, a `NaN` surviving a bare clamp (`typeof NaN` is
 * `'number'`), an enum accepting an unknown string. This module expresses a
 * group as ONE spec table instead, and {@link GroupSpec} makes the table
 * EXHAUSTIVE over the group's type: adding a field to the interface is a
 * compile error until its validation is declared.
 *
 * Each group's owner declares its own spec next to the type it validates (see
 * `ar/capture-motion-gate.ts`, `ar/image-quality.ts`,
 * `ar/ar-crash-isolation.ts`) — this module only supplies the primitive.
 */

/**
 * Per-field validation rule:
 *
 * - `bool` — accept only a real boolean.
 * - `num` — accept only a FINITE number (a stored `NaN` is `typeof 'number'`
 *   and would survive a bare clamp), optionally `round` to an integer first,
 *   then clamp to the constraint's min/max.
 * - `enum` — accept only a member of `values`.
 * - `custom` — field-specific logic (legacy migrations, nested groups); gets
 *   the whole raw group input plus the field's default.
 */
export type FieldSpec<T, K extends keyof T> =
  | { kind: 'bool' }
  | {
      kind: 'num';
      constraint: { readonly min: number; readonly max: number };
      round?: boolean;
    }
  | { kind: 'enum'; values: readonly NonNullable<T[K]>[] }
  | { kind: 'custom'; resolve: (options: Partial<T>, fallback: T[K]) => T[K] };

/**
 * One spec per field, EXHAUSTIVE over the group type `T` — the compile-time
 * guarantee that a newly added option cannot go unvalidated.
 */
export type GroupSpec<T> = { [K in keyof T]-?: FieldSpec<T, K> };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The `num` rule, extracted so the dispatch loop stays flat: reject anything
 * that is not a finite number (a stored `NaN` is `typeof 'number'` and would
 * survive the clamp), optionally round, then clamp.
 */
function resolveNum(
  value: unknown,
  constraint: { readonly min: number; readonly max: number },
  round: boolean | undefined,
  fallback: number
): number {
  const finite =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return clamp(
    round ? Math.round(finite) : finite,
    constraint.min,
    constraint.max
  );
}

/**
 * Validate one options group against its spec table.
 *
 * The output object's keys follow the SPEC's declaration order, so a group's
 * serialized JSON stays byte-stable across save→validate round-trips — declare
 * specs in the same order as the group's defaults.
 *
 * The casts inside the switch are contained here on purpose: TypeScript cannot
 * correlate `T[K]` with the matched spec kind inside a generic loop. Call sites
 * stay fully typed via {@link GroupSpec}.
 *
 * @param options Untrusted partial group (nullish is treated as "nothing set").
 * @param defaults The group's defaults; every rejected field falls back here.
 * @param specs One rule per field of `T`.
 */
export function validateOptionFields<T extends object>(
  options: Partial<T> | null | undefined,
  defaults: T,
  specs: GroupSpec<T>
): T {
  const input: Partial<T> = options ?? {};
  const result = {} as T;
  for (const key of Object.keys(specs) as (keyof T)[]) {
    const spec = specs[key];
    const fallback = defaults[key];
    const value = input[key];
    switch (spec.kind) {
      case 'bool':
        result[key] = (
          typeof value === 'boolean' ? value : fallback
        ) as T[typeof key];
        break;
      case 'num':
        result[key] = resolveNum(
          value,
          spec.constraint,
          spec.round,
          fallback as number
        ) as T[typeof key];
        break;
      case 'enum':
        result[key] = (
          (spec.values as readonly unknown[]).includes(value) ? value : fallback
        ) as T[typeof key];
        break;
      case 'custom':
        result[key] = spec.resolve(input, fallback);
        break;
    }
  }
  return result;
}
