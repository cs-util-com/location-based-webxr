# `agent-cycle.ts`

## Purpose

Turns a click on open ground into a planned route: posts the `planRoute` request,
shows the wait, and reports the two ways it can fail to produce a line
(DEC-R11-3).

## Public API

- `createAgentCycle(options) => (to: LatLng) => Promise<void>` — **never
  rejects**; its caller is a pointer handler, which has nothing to catch with.
- `AgentCycleOptions`
  - `worker` — narrowed to the one call it makes, so a test fakes an object
    rather than a client.
  - `agentAt(): LatLng | undefined` — **where the AGENT is**, not where the user
    is. `undefined` before the first publish, and the click is then dropped
    without touching the worker. `main.ts` composes it from
    `BuildingView.agentAt()` and falls back to the user's position only before
    the agent has been anywhere; reading the user for both made the agent
    teleport back to the start on a second order (review on #274).
  - `frameOrigin(): LatLng` — the scene's anchor; the protocol requires it.
  - `setBusy(busy)` — the in-progress state.
  - `showRoute(route)` — called only when there is a route.
  - `report(message)` — the user-visible error channel.

## Invariants & assumptions

- **Both inputs are read at CLICK time, not on arrival.** The frame decides what
  the returned heights mean, so reading it again after the search would describe
  the route in whatever frame the scene had been re-anchored to meanwhile. Same
  rule `geo-event-cycle.ts` follows for the position.
- **"No route" is the SLOWEST reply, not the fastest.** The search cannot know a
  destination is unreachable until its frontier is empty, so a mis-click across a
  wall costs the whole expansion cap — and that is the common mis-click. The
  reply most in need of a visible wait is therefore the one an implementation is
  most likely to treat as a no-op.
- **A refusal is surfaced, never swallowed.** `undefined` merges "nowhere to go"
  with "the search gave up" (see `agent-route.ts` for why a UI has no use for the
  difference), but silence would be indistinguishable from a dead control — a
  defect this demo has already shipped once, with a non-interactive tooltip.
- **A refusal does NOT clear the drawn route.** A search that could not be
  answered says nothing about the answer already on screen, and the agent may be
  part-way along a route it can walk. Same split `geo-event-cycle.ts` makes, and
  the same reason `nonFatalError` is used rather than `fetchFailed`.
- **`setBusy(false)` is in a `finally`.** A busy flag stuck on a rejection is a
  demo that looks permanently mid-request, which is worse than the failure.
- **A SUPERSEDED reply does nothing at all** — it neither draws, nor reports,
  nor clears the busy state. `latestOnly` serialises rather than cancels (the
  search is synchronous inside the worker, so an `abort` reaches a signal it
  never checks), so the older run comes back with a real answer. Without the
  generation guard a second click produced
  `setBusy(false) → showRoute(OLD) → setBusy(true) → showRoute(NEW)`: the wait
  visibly ended and restarted, and the stale route was drawn for one interval.
  Raised in review on #274.
- Non-`Error` rejections are reported through `String(error)`. Workers reject
  with whatever was thrown.

## Examples

```ts
const planAgentRoute = createAgentCycle({
  worker,
  agentAt: () => selectOsmView(store.getState()).position,
  frameOrigin: () => anchors.origin,
  setBusy: (busy) => (el("scene").dataset["routing"] = String(busy)),
  showRoute: (route) =>
    view.followRoute(
      scenePathOf(route, enuFrameAt(anchors.origin), ROUTE_LIFT_M),
    ),
  report: (message) => store.dispatch(actions.nonFatalError(message)),
});
```

`main.ts` wraps the result in `latestOnly`, so the newest click wins — the search
is synchronous inside the worker and cannot actually be preempted, so "the newest
click wins" is the honest guarantee rather than "the old one is cancelled".

## Tests

`agent-cycle.test.ts`. The transitional state is asserted on **both** paths, as
the root CLAUDE.md requires, and as a SEQUENCE (`[true]` then `[true, false]`)
rather than as "was busy at some point" — the latter is also true of an
implementation that sets and clears it in one tick, which shows the user nothing.
A deferred promise makes the in-flight window observable without timers.

Also covered: the refusal reaches `report` and draws nothing; a second,
unanswerable order leaves the first route on screen; the payload carries the
position and the frame read at dispatch; a rejection never propagates; a
non-`Error` throw is reported as text; and no position means no worker call.
