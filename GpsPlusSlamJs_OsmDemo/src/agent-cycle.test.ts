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

  it("DROPS a superseded reply rather than drawing it, and holds the busy state", async () => {
    // WHY THIS TEST MATTERS (raised in review on #274). `latestOnly` serialises
    // rather than cancels — the route search is synchronous inside the worker
    // and an `abort` cannot preempt it — so a second click while the first is
    // in flight used to produce the sequence
    //   setBusy(false) -> showRoute(OLD) -> setBusy(true) -> showRoute(NEW).
    // The cursor dropped out of `progress` mid-wait and the stale route was
    // drawn for one interval before being replaced.
    //
    // The generation guard makes the superseded run silent: it neither draws
    // nor clears the busy state, so the wait reads as one continuous wait and
    // only the newest answer ever reaches the scene.
    const first = deferred<readonly RoutePoint[] | undefined>();
    const second = deferred<readonly RoutePoint[] | undefined>();
    const gates = [first, second];
    let call = 0;
    const { order, busy, shown } = harness(() => gates[call++]!.promise);

    const running1 = order(THERE);
    const running2 = order(THERE);
    expect(busy).toStrictEqual([true, true]);

    // The SUPERSEDED reply lands first, which is the whole point: it is the
    // ordering the worker's queue actually produces.
    const OLD: RoutePoint[] = [{ position: HOME, heightM: 9 }];
    first.resolve(OLD);
    await running1;
    expect(shown).toStrictEqual([]);
    expect(busy).toStrictEqual([true, true]);

    second.resolve(ROUTE);
    await running2;
    expect(shown).toStrictEqual([ROUTE]);
    expect(busy).toStrictEqual([true, true, false]);
  });

  it("does not report a superseded FAILURE, which the user never asked about", async () => {
    // A superseded request that fails has nothing to tell anyone: its
    // replacement is already running, and an error toast for a click the user
    // has already overridden reads as the current click having failed.
    const first = deferred<readonly RoutePoint[] | undefined>();
    const second = deferred<readonly RoutePoint[] | undefined>();
    const gates = [first, second];
    let call = 0;
    const { order, reported } = harness(() => gates[call++]!.promise);

    const running1 = order(THERE);
    const running2 = order(THERE);

    first.reject(new Error("superseded and irrelevant"));
    await running1;
    expect(reported).toStrictEqual([]);

    second.resolve(ROUTE);
    await running2;
    expect(reported).toStrictEqual([]);
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

/**
 * Why these tests matter: DEC-R3 replaced a confident lie. A click beyond A*'s
 * ~374-529 m reach in a 2 400 m scene used to come back `undefined` and be
 * reported as "the agent cannot reach that spot". The clamp is only a fix if it
 * happens BEFORE dispatch — clamping after the search would keep paying for the
 * failure it exists to avoid — and only honest if the shortened order is said
 * out loud.
 */
describe("far clicks are clamped, not refused (DEC-R3)", () => {
  /** ~2 km north of HOME — far outside the reach, well inside the scene. */
  const FAR = { lat: HOME.lat + 0.018, lng: HOME.lng };

  it("dispatches a shortened destination, not the one clicked", () => {
    const { order, posted } = harness(() => Promise.resolve(ROUTE));
    return order(FAR).then(() => {
      const sent = posted[0] as { to: { lat: number; lng: number } };
      // The clamp must reach the worker, or the search still pays for the far
      // click and still fails.
      expect(sent.to.lat).toBeLessThan(FAR.lat);
      expect(sent.to.lat).toBeGreaterThan(HOME.lat);
      // Direction preserved: due north in, due north out.
      expect(sent.to.lng).toBeCloseTo(HOME.lng, 10);
    });
  });

  it("says the order was shortened, after drawing the route", () => {
    const { order, shown, reported } = harness(() => Promise.resolve(ROUTE));
    return order(FAR).then(() => {
      expect(shown).toEqual([ROUTE]);
      expect(reported).toHaveLength(1);
      expect(reported[0]).toContain("too far");
      // A silently shortened order looks like the click was ignored; the agent
      // stops somewhere the user did not point at with no explanation.
    });
  });

  it("stays silent and unchanged for a reachable click", () => {
    const { order, posted, reported } = harness(() => Promise.resolve(ROUTE));
    return order(THERE).then(() => {
      expect((posted[0] as { to: unknown }).to).toEqual(THERE);
      expect(reported).toEqual([]);
    });
  });

  it("still reports honestly when even the clamped order has no route", () => {
    // Clamping makes the refusal rare, not impossible — a detour is longer than
    // the crow flies, and the cap counts the detour. The old message is still
    // the right one here, and it must not be replaced by the clamp notice.
    const { order, reported } = harness(() => Promise.resolve(undefined));
    return order(FAR).then(() => {
      expect(reported).toEqual(["no route: the agent cannot reach that spot"]);
    });
  });
});
