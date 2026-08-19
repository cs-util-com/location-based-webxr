# `source/slot-budget.ts`

## Purpose

The client's own authoritative view of its Overpass slot allocation. Decides
whether a request may be dispatched **right now**.

## Public API

`new OverpassSlotBudget({ slots?, now?, maxPenaltyMs? })`

- **`available` and `msUntilAvailable()` with no arguments no longer see a
  penalty**, because every production caller now penalises an OPERATOR and
  the unqualified block is only set by an unqualified `penalise`. A consumer
  reading them for a rate-limit UI must pass the operators it cares about, or
  it will read a budget that never looks penalised.
- `available: number` — dispatchable slots; `0` while penalised regardless of
  count; `Infinity` when unlimited.
- `capacity: number`, `unlimited: boolean`
- `tryAcquire(operators?): boolean` — takes a slot if free. Never waits.
  Pass the operators the caller could actually reach; it then refuses only
  when **every** one of them is blocked. Omit them for the pre-2026-08-19
  behaviour (global penalty only).
- `release(): void` — returns a slot. Safe to over-call.
- `penalise(ms, operator?): void` — block dispatch, after a 429 or
  `Retry-After`. With an `operator` (the id `operatorForUrl` returns) it blocks
  only that operator; without one it blocks everything, as before.
- `availableFor(operator): number` — dispatchable slots for one operator.
- `msUntilAvailable(operators?): number` — the **soonest** recovery across the
  given operators, not the longest.
- `sync(status: OverpassStatus, operator?): void` — correct from
  `/api/status`. Any penalty it derives is attributed to `operator`, because
  `syncBudget` polls one nominated endpoint rather than the whole pool.

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
- **`penalise` keeps the LONGEST outstanding penalty**, not the most recent —
  within one operator. Across operators the accounts are independent: a short
  penalty on one must neither shorten nor lengthen another's.
- **The concurrency cap stays GLOBAL while penalties are per-operator.** The
  cap models this client's own outbound limit, so splitting it per operator
  would let one client dispatch three times its allocation by spreading it
  across the pool. Penalties model each server's quota, which is genuinely
  separate — three of the five default endpoints are FOSSGIS mirrors sharing
  one, which is why the key is the operator and not the hostname.
- **`tryAcquire` runs once per TILE, before an endpoint is drawn**, which is
  why it has to be told the pool. Getting this wrong in either direction
  breaks something shipped: refusing whenever _any_ operator is blocked is the
  F2c defect, and never refusing removes the `RateLimitedError` that
  `CachingSource`'s stale-serve and `area-loader`'s prefetch back-off both
  branch on.
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
if (!budget.tryAcquire(poolOperators)) return cachedTileOrUndefined(); // serve cache, queue
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
