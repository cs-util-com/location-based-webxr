# structural-read-error.ts

## Purpose

Marks a byte-source-backed read failure as **permanent** — never worth
retrying — as opposed to a plain `Error`, which a caller's retry policy may
treat as transient.

## Public API

- `class StructuralReadError extends Error`

## Invariants & assumptions

- `name` is fixed to `"StructuralReadError"`; carries no extra fields beyond
  the standard `Error` shape.
- Consumers (e.g. `RemoteRangeByteSource`, or a ref-counted asset provider
  built on top of a `ByteSource`) throw this for unknown ids, entries missing
  from a central directory, decode errors, and 4xx range reads; everything
  else is left as a plain `Error` for the caller to retry.

## Examples

```ts
try {
  await source.read(offset, length);
} catch (err) {
  if (err instanceof StructuralReadError) throw err; // don't retry
  // else: transient, retry with backoff
}
```

## Tests

No dedicated unit test — exercised via `remote-range-byte-source.test.ts`'s
4xx-structural / 5xx-transient split.
