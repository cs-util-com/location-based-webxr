/**
 * Ordering the agent: the round trip, and what the user sees while it runs.
 *
 * WHY THESE TESTS MATTER. The root CLAUDE.md requires an async UI action to show
 * an in-progress state and a settled one, **and to have a test asserting the
 * transitional state on BOTH the success and the failure path** — and this
 * action is the case that rule is hardest on:
 *
 * - The reply is a worker round trip, so there is a real wait to cover.
 * - **"No route" is the SLOWEST answer, not the fastest.** The search has to
 *   exhaust its frontier before it can know, which is exactly what every
 *   mis-click across a wall does. So the state most in need of feedback is the
 *   one it is easiest to forget.
 * - Silence on "no route" would be indistinguishable from a dead control, which
 *   this demo has already shipped once with a non-interactive tooltip.
 *
 * The ordering assertions use a deferred promise rather than timers: what must
 * be true is that busy is set BEFORE the await and cleared AFTER it, which is a
 * sequencing claim, and a timer would only be a slower way of asserting the same
 * thing less reliably.
 */

import { describe, expect, it, vi } from "vitest";

import { createAgentCycle } from "./agent-cycle.js";
import type { RoutePoint } from "./agent-route.js";

const HOME = { lat: 50.9413, lng: 6.9583 };
const THERE = { lat: 50.9415, lng: 6.9585 };
const ROUTE: RoutePoint[] = [
  { position: HOME, heightM: 0 },
  { position: THERE, heightM: 1 },
];

/** A promise the test settles by hand, so the in-flight window is observable. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(call: () => Promise<readonly RoutePoint[] | undefined>) {
  const busy: boolean[] = [];
  const shown: (readonly RoutePoint[] | undefined)[] = [];
  const reported: string[] = [];
  const posted: unknown[] = [];
  const order = createAgentCycle({
    worker: {
      call: (_kind, payload) => {
        posted.push(payload);
        return call();
      },
    },
    agentAt: () => HOME,
    frameOrigin: () => HOME,
    setBusy: (value) => busy.push(value),
    showRoute: (route) => shown.push(route),
    report: (message) => reported.push(message),
  });
  return { order, busy, shown, reported, posted };
}

describe("createAgentCycle", () => {
  it("is busy from the click until the reply, then not", async () => {
    // THE SUCCESS PATH's transitional state. Asserted as a SEQUENCE, because
    // "was busy at some point" is also true of an implementation that sets and
    // clears it in the same tick — which would show the user nothing.
    const gate = deferred<readonly RoutePoint[] | undefined>();
    const { order, busy, shown } = harness(() => gate.promise);

    const running = order(THERE);
    expect(busy).toStrictEqual([true]);
    expect(shown).toStrictEqual([]);

    gate.resolve(ROUTE);
    await running;

    expect(busy).toStrictEqual([true, false]);
    expect(shown).toStrictEqual([ROUTE]);
  });

  it("clears the busy state when the request FAILS, and says so", async () => {
    // THE FAILURE PATH's transitional state, which the rule names explicitly. A
    // busy flag left stuck on a rejection is a control that never comes back —
    // the demo would look permanently mid-request.
    const gate = deferred<readonly RoutePoint[] | undefined>();
    const { order, busy, reported } = harness(() => gate.promise);

    const running = order(THERE);
    expect(busy).toStrictEqual([true]);

    gate.reject(new Error("the worker died"));
    await running;

    expect(busy).toStrictEqual([true, false]);
    expect(reported).toStrictEqual(["route failed: the worker died"]);
  });

  it("SURFACES a refused route rather than drawing nothing", async () => {
    // The case the plan calls out: "no route" is the slowest reply and the one
    // that looks most like a broken button. It must reach the user's error
    // channel, and it must NOT take the existing route down — see below.
    const { order, reported, shown } = harness(() =>
      Promise.resolve(undefined),
    );

    await order(THERE);

    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatch(/no route/i);
    expect(shown).toStrictEqual([]);
  });

  it("leaves the drawn route alone when a new order cannot be answered", async () => {
    // Same reasoning as the geo-event cycle's: a search that failed says nothing
    // about the answer already on screen. Taking the polyline down would make a
    // mis-click look like the agent had given up on a route it is still walking.
    const routes: (readonly RoutePoint[] | undefined)[] = [ROUTE, undefined];
    let call = 0;
    const { order, shown } = harness(() =>
      Promise.resolve(routes[call++] ?? undefined),
    );

    await order(THERE);
    await order(THERE);

    expect(shown).toStrictEqual([ROUTE]);
  });

  it("sends the agent's position and the scene's frame, read at click time", async () => {
    // The frame origin is REQUIRED by the protocol precisely so a route cannot
    // be planned in a frame the scene is not drawn in. Reading both at dispatch
    // rather than on arrival is the same rule the geo-event cycle follows: the
    // answer describes where the user asked from, not where they ended up.
    const { order, posted } = harness(() => Promise.resolve(ROUTE));

    await order(THERE);

    expect(posted).toStrictEqual([
      { from: HOME, to: THERE, frameOrigin: HOME },
    ]);
  });

  it("never rejects, because its caller is a DOM listener", async () => {
    // A rejection here is an unhandled promise: the click handler has nothing to
    // catch it, and the failure has already been reported through `report` by
    // the time it would propagate.
    const { order } = harness(() => Promise.reject(new Error("boom")));
    await expect(order(THERE)).resolves.toBeUndefined();
  });

  it("reports a non-Error rejection as text rather than as [object Object]", async () => {
    // Workers reject with whatever was thrown, and a string throw is ordinary in
    // third-party code. `String(error)` is the honest fallback.
    // THROWN RATHER THAN `Promise.reject`d, so the lint rule that (rightly)
    // insists on rejecting with an `Error` does not have to be suppressed to
    // test what happens when something else does it anyway.
    const { order, reported } = harness(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point
      throw "overloaded";
    });

    await order(THERE);

    expect(reported).toStrictEqual(["route failed: overloaded"]);
  });

  it("does not call the worker at all when the agent has no position", async () => {
    // Defensive at the module boundary: before the first publish there is no
    // user position, and planning from `undefined` would either throw inside the
    // worker or plan from the equator.
    const call = vi.fn();
    const order = createAgentCycle({
      worker: { call },
      agentAt: () => undefined,
      frameOrigin: () => HOME,
      setBusy: () => undefined,
      showRoute: () => undefined,
      report: () => undefined,
    });

    await order(THERE);

    expect(call).not.toHaveBeenCalled();
  });
});
