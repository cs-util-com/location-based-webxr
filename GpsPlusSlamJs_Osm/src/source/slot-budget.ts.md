# `source/slot-budget.ts`

## Purpose

The client's own authoritative view of its Overpass slot allocation. Decides
whether a request may be dispatched **right now**.

## Public API

`new OverpassSlotBudget({ slots?, now?, maxPenaltyMs? })`

- `available: number` — dispatchable slots; `0` while penalised regardless of
  count; `Infinity` when unlimited.
- `capacity: number`, `unlimited: boolean`
- `tryAcquire(): boolean` — takes a slot if free. Never waits.
- `release(): void` — returns a slot. Safe to over-call.
- `penalise(ms): void` — block dispatch, after a 429 or `Retry-After`.
- `msUntilAvailable(): number`
- `sync(status: OverpassStatus): void` — correct from `/api/status`.

## Invariants & assumptions

- **This is local and authoritative; `/api/status` is only a correction.**
  Measured 2026-07-28: three concurrent queries returned `200, 429, 200` while a
  status read 600 ms into the burst still reported the full allocation free. A
  client that asked the server "may I?" before each request would still get
  429s. This measurement is the reason the class exists.
- **`sync` is asymmetric: it may make the client more cautious, never less.**
  Believing an optimistic snapshot would reset the budget using the very
  response that proves optimism wrong. A pessimistic snapshot IS trusted —
  something consumed the allocation we did not account for.
- **The allocation size from `sync` is always adopted**, so a self-hosted
  instance allowing more (or fewer) than the public 2 is honoured.
- **`penalise` keeps the LONGEST outstanding penalty**, not the most recent.
  With two 429s in flight, a short second penalty must not cancel a long first.
- **Penalties are clamped** to `maxPenaltyMs` (default 120 s) and floored at 0.
  `Retry-After` is third-party input: an absurd value must not brick the client
  for a day, and a negative one must not unblock it. Under-waiting costs one
  more 429, which is cheap and self-correcting.
- **`release` never counts below zero.** A release path running in both a `then`
  and a `finally` would otherwise hand out unlimited quota.
- `msUntilAvailable()` returns 0 when slots are merely _in use_ — that resolves
  when our own request completes, which the caller already awaits. A non-zero
  value always means "the server told us to wait".
- Defaults: 2 slots (the measured public `Rate limit`), 120 s max penalty.

## Examples

```ts
const budget = new OverpassSlotBudget();
if (!budget.tryAcquire()) return cachedTileOrUndefined(); // serve cache, queue
try {
  return await fetchTile(cell);
} finally {
  budget.release();
}
```

## Tests

- `slot-budget.test.ts` — acquire/release accounting, over-release, penalty
  precedence and clamping, and each branch of `sync` (adopt capacity, refuse to
  raise, accept lowering, unlimited).
- `slot-budget.property.test.ts` — over arbitrary interleavings of
  acquire/release/penalise/clock-advance: concurrency never exceeds the
  allocation, availability is never negative or NaN, the budget always recovers
  once the clock passes every penalty, and a sync never raises availability.
