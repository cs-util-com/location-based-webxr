# `route-order.ts`

## Purpose

How far an agent may be ordered in one click, and what to do about a click
beyond it (DEC-R3).

## The defect it replaces

A\* is bounded by an expansion cap, which buys a reach of roughly **374–529 m**
of open ground — the range rather than a point, because the cap bounds _states_
and a state is a `(cell, height)` column, so the answer halves wherever a cell
carries two standable levels. The drawn scene is **2 400 m** across.

So a click in the far half of the visible world returned `undefined`, which the
UI reported as _"the agent cannot reach that spot"_ — **a confident lie, not a
slow answer**. No test caught it: the only long-route test supplies a score
gradient that gives A\* real guidance, so the uniform-ground case was untested by
construction.

## Public API

- `MAX_ORDER_M = 300` — the furthest a single order may reach.
- `clampOrder(from, to, maxMetres?) → { to, clamped }`.

## Invariants & assumptions

- **Clamp, do not refuse** (owner decision). A player who clicked the horizon
  wanted movement, not a message.
- **It must happen BEFORE dispatch**, and that is the half that makes it a fix
  rather than a cosmetic. Clamping shrinks the search; the search runs
  synchronously in the worker and its cap doubles as a **publish-latency bound**
  (`worker/protocol.ts`), so a fix that grew the search would trade one defect
  for another.
- **Direction is preserved exactly**; only distance changes. Sending the agent
  somewhere other than toward the click is a different order, not a shortened
  one. `route-order.test.ts` checks this on a diagonal, where a bug that clamped
  the axes independently would show as a bearing change.
- **300 m is set from the PESSIMISTIC end of the reach**, with margin. Choosing
  529 would clamp to a distance the search cannot reach wherever obstacles add a
  second level — which is exactly the ground a player is most likely to click.
  The extra margin below 374 covers the other reason a straight line understates
  the search: **a route that detours is longer than the crow flies, and the cap
  counts the detour.**
  - A test asserts `MAX_ORDER_M < 374`, so raising it toward the optimistic
    figure fails and asks for a re-measurement rather than letting far clicks
    quietly start refusing again.
- **Clamping makes the refusal rare, not impossible**, and nothing here pretends
  otherwise — `agent-cycle.ts` still reports "no route" when even the shortened
  order has none.
- **A non-finite destination passes through untouched.** It is an upstream
  fault; clamping it would produce a plausible position and hide the fault.
- The longitude scale is taken at the **start** latitude, not the midpoint: the
  difference is far below the clamp's own margin at any latitude a user stands,
  and a midpoint would have to be derived from the answer being computed.
- The pole is guarded — a zero cosine would divide the longitude step by nothing.

## Examples

```ts
const { to, clamped } = clampOrder(agentAt(), clickedPoint);
if (clamped) report(`too far — walking as far as it can (${MAX_ORDER_M} m)`);
```

## Tests

`route-order.test.ts` — a reachable order untouched, a far order shortened to the
limit, direction preserved on a diagonal, never lengthened, degenerate
destinations passed through, the injectable limit, and the guard on
`MAX_ORDER_M`'s value.

`agent-cycle.test.ts` — "far clicks are clamped, not refused": that the shortened
destination is what reaches the worker, that the shortening is reported after the
route is drawn, that a reachable click is silent and unchanged, and that a
genuinely routeless clamped order still reports honestly. Verified to go red when
the clamp is disabled.
