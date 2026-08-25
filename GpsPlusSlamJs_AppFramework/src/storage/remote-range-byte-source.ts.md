# remote-range-byte-source.ts

## Purpose

The remote half of range-based archive streaming: `probeRemote` (the opening
HEAD + `Range: bytes=0-0` probe) and `RemoteRangeByteSource` (a `ByteSource`
that issues one HTTP Range fetch per read).

## Public API

- `type FetchImpl = typeof fetch`
- `probeRemote(url: string, fetchImpl: FetchImpl): Promise<ProbeResult>` — see
  `range-probe.ts` for `ProbeResult`. Throws if `fetch` rejects (CORS/network).
  Captures freshness validators (ETag/Last-Modified) where readable — from
  the HEAD, or the probe GET when HEAD fails.
- `fetchRemoteValidators(url, fetchImpl): Promise<{ size, validators? } | null>`
  — one lightweight HEAD for size + validators; null when the HEAD fails or
  is refused. The cache-revalidation check `open-remote-archive.ts` runs
  before deciding whether a full probe is needed.
- `class RemoteRangeByteSource implements ByteSource`
  - `constructor(url: string, size: number, fetchImpl: FetchImpl)`
  - `read(offset, length): Promise<Uint8Array>`

## Invariants & assumptions

- Every fetch (HEAD, probe GET, range read) carries an `AbortSignal.timeout`
  so a hung connection becomes a rejection instead of stalling forever.
- A range read requires **exactly 206**. A 200 means the host ignored `Range`
  and streamed the whole archive — returning that as the slice would silently
  corrupt every downstream parse, so it throws `StructuralReadError` (the
  caller re-probes and falls back to a full download). A 4xx (expired signed
  link, file gone, bad range) also throws `StructuralReadError` (permanent,
  never retried); any other failure is a plain `Error` (transient,
  retry-eligible by a caller's policy).
- The returned body must be exactly `length` bytes, or the read fails
  structurally. `Content-Range` is additionally validated against the
  requested offsets — but only when readable: the header is not
  CORS-safelisted, and e.g. raw.githubusercontent exposes no headers, so a
  null `Content-Range` on a 206 is normal, not an error.
- A zero-length read resolves to an empty array locally — `bytes=X-(X-1)`
  would be an invalid Range header, so it never reaches the network.
- `probeRemote` adopts a size only from a **successful** HEAD (an error page
  has a Content-Length too) and only when it is a finite safe non-negative
  integer — `Number('abc')` is `NaN`, and `NaN ?? fallback` never falls back.
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
abort-signal presence, the 4xx-structural / 5xx-transient split, the 206
requirement (200 full-body rejection), body-length and Content-Range
validation (incl. the CORS-hidden-header acceptance case), zero-length
short-circuit, and `probeRemote`'s failed-HEAD / unusable-Content-Length
guards.
