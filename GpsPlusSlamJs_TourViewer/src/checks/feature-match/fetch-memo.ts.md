# fetch-memo.ts

## Purpose

A `fetch` that keeps each URL's bytes once fetched. The measuring worker builds its methods again for every pair; without the memo each pair would fetch (or read from the HTTP cache) every model again. It lives as long as the worker: a crash empties it.

## Public API

- `memoFetch(fetchFn)` -> a `fetch` with the same signature.

## Invariants and defensive measures

- Each call gets its own `Response` over a copy of the bytes, so every caller can read the body.
- Concurrent calls for one URL share one fetch.
- A rejected fetch is not kept: the caller sees the rejection and the next call fetches again.
- An error status (`!res.ok`) is returned to its callers as it came (a clone each) and not kept, so a passing server error is retried by the next pair.
- Status, status text and headers of a kept response are carried over.

## Example

```ts
const deps = { ...loadDeps, fetch: memoFetch((url, init) => fetch(url, init)) };
```

## Tests

`fetch-memo.test.ts`: one fetch per URL with a readable body for each caller, and neither a rejected fetch nor an error status kept.
