# same-json.ts

## Purpose

Whether two JSON-like values are the same data, whatever order their
objects' keys were built in. `JSON.stringify(a) === JSON.stringify(b)`
compares key order too, so a station frame rebuilt by another writer (a
parse, a spread in another order) read as changed: a pending change that
was none, and a leave guard asking about a tour with nothing to save.

## Public API

- `sameJson(a: unknown, b: unknown): boolean` - true when the two values
  serialize alike once every object's keys are sorted. Never throws on
  JSON data; a cycle throws, as `JSON.stringify` does.

## Invariants & assumptions

- JSON's own semantics otherwise: a key whose value is `undefined` is
  absent, NaN and the infinities read as null, arrays keep their order.
- Whatever plain `JSON.stringify` calls equal, this calls equal too: it
  only ever forgives key order. Symmetric.
- An own `"__proto__"` key (one `JSON.parse` can produce) is compared like
  any other: the sorted copy has no prototype, so writing the key never
  reaches the prototype setter. Before this, two values differing only under
  such a key read as the same.
- For plain data only, which is what a tour file carries: a value with
  `toJSON` (a Date) or a class instance is compared by its own enumerable
  keys.
- Cost: one sorted copy and one serialization per side; the values
  compared (station frames) are small.

## Where it is used

- `tour-document.ts`: a frame against the written file's (`sameFrame`,
  read by `changeCount` and so by the leave guard), the history view's
  stations against the document's, and a landed write's frames against
  the ones it started from.
- `tour-document-draft.ts`: a stored station pose against the opened
  tour's (`changedStations`, what the draft offers as moved).

One implementation per package (DEC-H3); no equivalent existed in either
workspace root (`summary-model.ts`'s `samePose` compares within a
tolerance, a different contract).

## Examples

```ts
sameJson({ lat: 1, lon: 2 }, { lon: 2, lat: 1 }); // true
sameJson({ lat: 1, lon: 2 }, { lat: 1 }); // false
sameJson([1, 2], [2, 1]); // false
```

## Tests

- `same-json.test.ts` - key order ignored at any depth; a changed value, a
  missing key, another array order told apart; an `undefined`-valued key
  absent; an own `__proto__` key told apart.
- `same-json.property.test.ts` - over any JSON value: equal to itself with
  its keys reordered; equal by `JSON.stringify` implies equal here, and
  symmetric; a changed leaf is a change.
- `tour-document.test.ts` - a station moved and moved back with its geo
  keys in another order is no change.
