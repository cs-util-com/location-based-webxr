# remote-range-byte-source.ts

## Purpose

The remote half of range-based archive streaming: `probeRemote` (the opening
HEAD + `Range: bytes=0-0` probe) and `RemoteRangeByteSource` (a `ByteSource`
that issues one HTTP Range fetch per read).

## Public API

- `type FetchImpl = typeof fetch`
- `probeRemote(url: string, fetchImpl: FetchImpl): Promise<ProbeResult>` — see
  `range-probe.ts` for `ProbeResult`. Throws if `fetch` rejects (CORS/network).
- `class RemoteRangeByteSource implements ByteSource`
  - `constructor(url: string, size: number, fetchImpl: FetchImpl)`
  - `read(offset, length): Promise<Uint8Array>`

## Invariants & assumptions

- Every fetch (HEAD, probe GET, range read) carries an `AbortSignal.timeout`
  so a hung connection becomes a rejection instead of stalling forever.
- A 4xx range read (expired signed link, file gone, bad range) throws
  `StructuralReadError` (permanent, never retried); any other failure is a
  plain `Error` (transient, retry-eligible by a caller's policy).
- `fetchImpl` is re-invoked as a **free call**, not `this.#fetch(...)` — a
  real browser `fetch` brand-checks its receiver and throws
  `TypeError: Illegal invocation` if called method-style on anything but the
  global scope. Node's `fetch` (undici) does not enforce this, so this bug is
  invisible to a Node-only test suite unless it fakes the brand check (see the
  test file).

## Examples

```ts
const probe = await probeRemote(url, fetch);
const source = new RemoteRangeByteSource(url, probe.size!, fetch);
const bytes = await source.read(0, 1024);
```

## Tests

`remote-range-byte-source.test.ts` — the browser-`fetch` receiver brand check,
abort-signal presence, and the 4xx-structural / 5xx-transient split.
