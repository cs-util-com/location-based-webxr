# `latest-only.ts`

## Purpose

Serialises an async action and coalesces waiting requests down to the most
recent one, so a slow fetch cannot be overtaken by a newer click.

## Public API

- `latestOnly<T>(run: (input: T) => Promise<void>): LatestOnly<T>` — returns a
  callable wrapper. Calling it either starts `run` immediately or replaces the
  single queued input.
- `LatestOnly<T>` — the wrapper: callable as `(input: T) => Promise<void>`, plus
  a readonly `busy` boolean.

## Invariants & assumptions

- **At most one `run` is in flight.** The demo's `refresh` drives one
  `AffordanceIndex` and one `MapView`; two concurrent runs mutate shared state
  and let the earlier one write the final status line.
- **Only ONE input waits, and the newest replaces it.** Everything between the
  active run and the newest input is work whose result would be overwritten
  anyway — so it is skipped, never queued up to run in turn.
- **No request is ever refused.** A plain lock would also serialise, at the cost
  of an 18 s dead zone after every click; the demo's only interaction is
  clicking around the map, so refusing clicks is not an option. What gets
  dropped is intermediate work, never the user's final intent.
- **The returned promise settles when the wrapper goes idle**, not when the
  caller's own input finishes. For a superseded input the latter would be a lie
  — that input never ran.
- **Never rejects.** A runner that throws leaves the wrapper ready for the next
  call: turning a transient Overpass 429 into a permanently dead demo would be a
  worse failure than the race this replaces. Reporting the error stays the
  runner's job, since it has the context to say what failed.

## Examples

```ts
const refresh = latestOnly(doRefresh);
mapView.map.on('click', () => void refresh());
if (refresh.busy) status.textContent = 'still fetching…';
```

## Tests

`latest-only.test.ts` — the first call running immediately, never two at once,
the latest queued input running while superseded ones are skipped, the last
input being the one the view ends on, surviving a rejected run, and `busy`
tracking the in-flight state.

Tested here rather than through the DOM because `main.ts` is wiring with no unit
tests, and the Playwright suite serves a canned fixture that resolves instantly
— the overlap window that makes the bug possible does not exist there. That is
the same coverage gap the `?lat=&lng=` guard fell into on the previous PR.
