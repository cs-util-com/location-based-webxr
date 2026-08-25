# byte-source.ts

## Purpose

The swappable random-access byte-source seam behind range-based archive
streaming. `SwitchableByteSource` holds a `current` source and flips it once,
atomically — the mechanism a consumer uses to move from a remote Range fetch
to a local cache mid-session without whatever reads through it (e.g. a zip.js
`Reader`, see `zip-byte-source-reader.ts`) ever noticing.

## Public API

- `interface ByteSource { readonly size: number; read(offset, length): Promise<Uint8Array> }`
- `class SwitchableByteSource implements ByteSource`
  - `constructor(initial: ByteSource)`
  - `switchTo(next: ByteSource): boolean` — swaps the backing source; reports
    whether the swap took effect (`false` on size mismatch or duplicate — a
    warm-download caller must not persist bytes whose swap was refused).

## Invariants & assumptions

- Swaps **at most once**: a second `switchTo` call is a no-op (guards against
  a duplicate warm/fallback race re-firing).
- Refuses a source whose `size` differs from the original — every parsed
  offset (e.g. a zip central directory) is anchored to the original size, so
  mismatched bytes (redirect page, truncated body) would silently corrupt
  every later read.
- A read captures its source **at call entry**: an in-flight read finishes
  from the source it started on; only reads issued _after_ `switchTo` see the
  new source.

## Examples

```ts
const src = new SwitchableByteSource(remote);
// … background warm completes …
src.switchTo(local); // new reads local; in-flight reads still finish on remote
```

## Tests

`byte-source.test.ts` — delegate, switch, idempotent second switch, refused
mismatched-size switch, and the in-flight-read-finishes-on-old-source race.
