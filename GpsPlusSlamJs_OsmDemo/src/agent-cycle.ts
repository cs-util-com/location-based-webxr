/**
 * The agent cycle: a click in, a route out, and the wait made visible.
 *
 * WHY IT IS A MODULE RATHER THAN A CLOSURE IN `main.ts`. The same reason
 * `explain-cycle.ts` and `geo-event-cycle.ts` give — an action with a busy
 * state, a failure path and a "the answer is no" path cannot be unit-tested
 * inside the app shell, and all three of those paths are the ones users notice.
 *
 * WHY THE FEEDBACK MATTERS MORE HERE THAN THE ROUTE DOES. The root CLAUDE.md
 * requires an in-progress state and a settled one for any async UI action, and
 * this action inverts the usual intuition about which case is fast:
 *
 * > **"No route" is the SLOWEST reply, not the quickest.** The search cannot
 * > know that a destination is unreachable until its frontier is empty, so a
 * > mis-click on the far side of a wall costs the full expansion cap — and that
 * > is the common mis-click, not a rare one.
 *
 * So the reply that most needs a visible wait is exactly the one an
 * implementation is most likely to treat as a no-op, and silence there is
 * indistinguishable from a dead control.
 *
 * WHY A REFUSED ROUTE DOES NOT CLEAR THE DRAWN ONE. Same rule the geo-event
 * cycle follows: a search that could not be answered says nothing about the
 * answer already on screen. The agent may be part-way along a route it CAN
 * walk, and taking that away because a later click landed inside a building
 * would read as the agent giving up.
 *
 * @see agent-cycle.ts.md
 */

import type { LatLng } from "gps-plus-slam-osm";

import { clampOrder, MAX_ORDER_M } from "./route-order.js";
import type { RoutePoint } from "./agent-route.js";

/** The part of the worker client this needs; narrowed so tests can fake it. */
interface RouteWorker {
  call(
    kind: "planRoute",
    payload: {
      from: LatLng;
      to: LatLng;
      frameOrigin: LatLng;
    },
  ): Promise<readonly RoutePoint[] | undefined>;
}

export interface AgentCycleOptions {
  readonly worker: RouteWorker;
  /**
   * Where the agent is standing, read at CLICK time.
   *
   * `undefined` before the first publish, when the demo has no position yet.
   * Planning from a missing start would either throw inside the worker or plan
   * from the equator, so the click is dropped instead.
   */
  readonly agentAt: () => LatLng | undefined;
  /** Where the scene's ENU frame is anchored — what the route's heights mean. */
  readonly frameOrigin: () => LatLng;
  /**
   * Reflects the request's in-progress state.
   *
   * Not store state, for the same reason the geo-event cycle's is not: "a route
   * is being planned" is a property of this cycle rather than of the data, and
   * putting it in the store would make it persistable for no gain.
   */
  readonly setBusy: (busy: boolean) => void;
  /** Draws the route. Called only when there is one to draw. */
  readonly showRoute: (route: readonly RoutePoint[]) => void;
  /** The user-visible error channel, for a refusal or a failure. */
  readonly report: (message: string) => void;
}

/** `Error` messages when we have one, the value's text when we do not. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the "send the agent there" action.
 *
 * The returned function never rejects. Its caller is a pointer handler, so a
 * rejection would be unhandled — and the failure has already been reported
 * through `report` by the time it would have propagated.
 */
export function createAgentCycle(
  options: AgentCycleOptions,
): (to: LatLng) => Promise<void> {
  const { worker, agentAt, frameOrigin, setBusy, showRoute, report } = options;

  /**
   * Which dispatch is current. Everything a reply does is gated on it.
   *
   * **`latestOnly` SERIALISES; IT DOES NOT CANCEL** — the route search is
   * synchronous inside the worker, so an `abort` reaches a signal the search
   * never checks. The superseded run therefore runs to completion and comes
   * back with a real answer, and without this guard it produced
   * `setBusy(false) → showRoute(OLD) → setBusy(true) → showRoute(NEW)`: the
   * cursor dropped out of its wait state mid-wait and the stale route was drawn
   * for one interval. Raised in review on #274.
   */
  let generation = 0;

  return async (requested: LatLng): Promise<void> => {
    const from = agentAt();
    if (from === undefined) return;
    // CLAMPED BEFORE DISPATCH (DEC-R3). A* reaches ~374-529 m of open ground
    // inside its expansion cap while the drawn scene is 2 400 m across, so a far
    // click used to come back `undefined` and be reported as "cannot reach that
    // spot" — untrue, and the most confident thing the demo said. Walking as far
    // as it can is what the click meant.
    //
    // HERE rather than in the worker, because clamping SHRINKS the search: the
    // search runs synchronously and its cap doubles as a publish-latency bound
    // (`worker/protocol.ts`), so the fix must not make the search bigger.
    const { to, clamped } = clampOrder(from, requested);
    // CAPTURED AT DISPATCH, all three. The frame decides what the returned
    // heights mean, and reading it again on arrival would describe the route in
    // whatever frame the scene had been re-anchored to while the search ran.
    const origin = frameOrigin();
    const mine = ++generation;
    /** True while this dispatch is still the one the user is waiting for. */
    const current = (): boolean => mine === generation;

    setBusy(true);
    let route: readonly RoutePoint[] | undefined;
    try {
      route = await worker.call("planRoute", { from, to, frameOrigin: origin });
    } catch (error) {
      // A SUPERSEDED FAILURE IS SILENT. Its replacement is already running, and
      // an error toast for a click the user has overridden reads as the current
      // click having failed.
      if (current()) report(`route failed: ${messageOf(error)}`);
      return;
    } finally {
      // IN A `finally`, so the control comes back on every path — but only for
      // the dispatch that is still current. A busy flag left stuck on a
      // rejection is a demo that looks permanently mid-request; a busy flag
      // cleared by a superseded run is a wait that visibly ends and restarts
      // while the user is still waiting for one answer.
      if (current()) setBusy(false);
    }

    if (!current()) return;

    if (route === undefined) {
      // SURFACED, NOT SWALLOWED. `undefined` merges "nowhere to go" with "the
      // search gave up", deliberately — a UI has nothing to do with the
      // difference — but it must still say something, or the slowest reply in
      // the demo is also its most silent one.
      report("no route: the agent cannot reach that spot");
      return;
    }
    // SAID OUT LOUD (DEC-R3). A silently shortened order looks like the click
    // was ignored — the agent stops somewhere the user did not point at, with no
    // explanation. Reported AFTER the route is drawn so the message describes
    // something already on screen.
    showRoute(route);
    if (clamped) {
      report(`too far — walking as far as it can (${MAX_ORDER_M} m)`);
    }
  };
}
