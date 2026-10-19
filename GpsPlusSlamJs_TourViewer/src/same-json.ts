/**
 * Whether two JSON-like values are the same data, whatever order their
 * objects' keys were built in.
 *
 * `JSON.stringify(a) === JSON.stringify(b)` is the obvious test and a wrong
 * one: it compares key order too, so a station frame rebuilt by another
 * writer (a parse, a spread in another order) read as changed. This keeps
 * JSON's own semantics otherwise - a key whose value is `undefined` is
 * absent, NaN and the infinities read as null, an array keeps its order -
 * by serializing each value with its keys sorted.
 *
 * For plain data only (what a tour file carries): a value with `toJSON`
 * (a Date) or a class instance is compared by its own enumerable keys, and
 * a cycle throws, as `JSON.stringify` does.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(sortedKeys(a)) === JSON.stringify(sortedKeys(b));
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = sortedKeys(record[key]);
  }
  return out;
}
