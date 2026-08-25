# range-probe.ts

## Purpose

The range-vs-fallback policy for opening a hosted archive over HTTP, as one
pure function (`decideFallback`) plus its one HTTP-header helper
(`parseContentRangeTotal`). A transport (`remote-range-byte-source.ts`) does
the actual HEAD + `Range: bytes=0-0` GET and hands the raw result here — every
branch is provable without a server.

## Public API

- `parseContentRangeTotal(header: string | null): number | null` — total size
  from a `Content-Range: bytes <range>/<total>` header, or null if
  unknown/absent/malformed — or not a safe integer (an imprecise double must
  never anchor zip offsets).
- `interface ProbeResult { status: number; size: number | null; body?: Uint8Array }`
- `type RangeProbeRejectCause = "unusable-link" | "cors" | "corrupt" | "missing"`
- `type FallbackDecision = { mode: "ranges"; size } | { mode: "eager-local"; body } | { mode: "full-download" } | { mode: "reject"; cause: RangeProbeRejectCause }`
- `decideFallback(probe: ProbeResult): FallbackDecision`

## Invariants & assumptions

- `206` + known size → `ranges`. `206` with no size anywhere (HEAD gave none,
  `Content-Range` unreadable) → `full-download` (a range-reading archive
  parser needs the total to anchor e.g. a zip central directory, but a plain
  download still works). `200` + body → `eager-local` (host ignored Range and
  streamed the whole file). `404` → reject(`missing`). `416` → reject(`corrupt`).
  Anything else → reject(`unusable-link`).
- A `206` size that is not a finite safe non-negative integer (a caller let
  `NaN`, a negative, or a float through) is treated as unknown →
  `full-download`, never `ranges` — boundary defense mirroring the validation
  in `probeRemote`.
- `RangeProbeRejectCause` covers only what the probe itself can produce. A
  consumer with its own fatal causes (e.g. "the file parsed but its contents
  were invalid") extends this union locally rather than this module growing
  app-specific causes.

## Examples

```ts
const probe = await probeRemote(url, fetch); // see remote-range-byte-source.ts
const decision = decideFallback(probe);
if (decision.mode === 'reject') throw new MyOpenError(decision.cause);
```

## Tests

`range-probe.test.ts` — `parseContentRangeTotal`'s satisfied/unsatisfied/
unknown/malformed forms, and `decideFallback`'s full status table including
the full-download degrade branch.
