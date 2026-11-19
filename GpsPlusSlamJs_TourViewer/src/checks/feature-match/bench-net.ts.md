# bench-net.ts

## Purpose

Downloads and their accounting for the benchmark: timed fetches, resource-timing summaries, and the injectable loader the methods use.

## Public API

- `DownloadRecord { label, bytes | null, ms, cached | null, files }`.
- `ResourceLike`: the fields of a `PerformanceResourceTiming` the page reads.
- `errorText(e)`: `Name: message` for errors, `String(e)` otherwise.
- `formatBytes(n | null)`: B, KB, MB in powers of 1000; `-` for null.
- `summarizeResources(entries, prefix, label)`: all entries under a URL prefix as one record, or null if none. `bytes` is null when any entry hides its size (a cross-origin file without `Timing-Allow-Origin`); `cached` is true when nothing came over the network.
- `fetchBytes(url, label, { fetch, now, lookup? })`: the body as bytes and its record; throws `<label>: HTTP <status> for <url>` on a non-ok response.
- `LoadDeps { importModule, fetch, now, resources }`: what a method needs from the browser; tests pass fakes.
- `lookupIn(deps)`: the resource entry of one URL.

## Invariants

- No network access of its own: every call goes through the injected functions.

## Tests

`bench-net.test.ts`.
